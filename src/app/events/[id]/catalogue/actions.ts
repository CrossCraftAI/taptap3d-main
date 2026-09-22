"use server";

import { revalidatePath } from "next/cache";

import { currentActorId } from "@/lib/data/actor";
import {
  createPin,
  deletePin,
  ensureCatalogue,
  getCatalogue,
  updateCatalogueParams,
} from "@/lib/data/catalogues";
import { getLot } from "@/lib/data/lots";
import { currentOrgId } from "@/lib/data/org";
import { setOverride } from "@/lib/data/overrides";
import { normaliseParams } from "@/lib/engine/derive";
import { frameFromValue, intersectsPage, type OverrideFrame } from "@/lib/engine/frame";
// From src/lib/forms.ts, because a "use server" file may export only async
// functions and the panel's initial state is an object.
import type { PinFormState, PlaceResult } from "@/lib/forms";

/**
 * Pin the selected lots together.
 *
 * The selection arrives as one `lotId` per ticked box — the MEMBERS, and
 * nothing about where they were on screen when the specialist chose them.
 * `createPin` refuses a selection the engine could not honour and says why;
 * that answer comes back to the panel instead of a pin that does nothing.
 */
export async function pinTogetherAction(
  eventId: string,
  _previous: PinFormState,
  formData: FormData,
): Promise<PinFormState> {
  const orgId = await currentOrgId();
  const catalogue = await ensureCatalogue(orgId, eventId);
  const lotIds = formData
    .getAll("lotId")
    .filter((v): v is string => typeof v === "string" && v.length > 0);

  const result = await createPin(orgId, catalogue.id, lotIds);
  if (!result.ok) return { message: result.reason, at: Date.now() };

  revalidatePath(`/events/${eventId}/catalogue`);
  return { message: null, at: Date.now() };
}

/** Unpin. Bound to its ids by the panel; the form carries nothing else. */
export async function unpinAction(
  eventId: string,
  pinId: string,
  _formData: FormData,
): Promise<void> {
  const orgId = await currentOrgId();
  await deletePin(orgId, pinId);
  revalidatePath(`/events/${eventId}/catalogue`);
}

/**
 * Change the template or the layout parameters.
 *
 * Density is a DEFAULT, NOT A LOCK (principle 9): it is stored so the catalogue
 * reopens where the specialist left it, and it re-derives every slot rather than
 * freezing any. Nothing keyed to a page survives this — nothing is keyed to a
 * page. Nor does a template change touch an override or a pin: both are keyed
 * to lots, and the engine re-applies them on the price list exactly as it did
 * on the grid.
 *
 * Everything posted is resolved AGAINST THE TEMPLATE by `normaliseParams`: a
 * density the new template does not offer becomes its default, a placement it
 * has no plate for becomes the one it has. The form does not know the
 * template's vocabulary and does not need to.
 */
export async function setCatalogueParamsAction(
  eventId: string,
  formData: FormData,
): Promise<void> {
  const orgId = await currentOrgId();
  const catalogue = await ensureCatalogue(orgId, eventId);

  const params = normaliseParams({
    template: String(formData.get("template") ?? ""),
    perPage: Number(formData.get("perPage")),
    imagePlacement: String(formData.get("imagePlacement") ?? ""),
    showRef: formData.get("showRef") === "on",
    fit: String(formData.get("fit") ?? ""),
  });

  await updateCatalogueParams(orgId, catalogue.id, { ...params });
  revalidatePath(`/events/${eventId}/catalogue`);
}

/** A field key is a column name a house chose; this bounds it, nothing more. */
const MAX_FIELD = 80;

/**
 * Where a person put one part of one lot, in fractions of the PAGE.
 *
 * ── THE SECOND WRITER OF A PATCH, AND THAT IS THE POINT ─────────────────────
 *
 * It sends `{ frame }` and nothing else. One override row holds every kind of
 * judgement about one (lot, field) — a hidden field, a corrected string, a
 * chosen ground — so a drag that wrote a whole value would erase the typo fix
 * somebody made a minute earlier, and the lot form would erase the drag. That
 * is the most expensive thing the table can do and the one failure it cannot
 * be argued out of afterwards; `OverridePatch` exists for it, and this is the
 * second thing to use it (src/lib/data/overrides.ts).
 *
 * ── IT VALIDATES WITH THE ENGINE'S OWN PREDICATE ────────────────────────────
 *
 * `intersectsPage`, imported, not mirrored. The browser refuses the same frame
 * before it posts (src/lib/editor/overlay-model.ts, `placementFrame`), and
 * both call THIS function — so a pointless round trip never leaves the browser
 * and a frame that reaches the database has passed one predicate rather than
 * two that could disagree. A refusal here therefore means something went wrong
 * between the two, which is worth a sentence rather than a silent no-op.
 *
 * The precision is not applied here: `overrideFromValue` rounds on the way in
 * and on the way out, in the one place both paths pass through, so the number
 * the engine applies and the number the row holds are the same number.
 *
 * ── AN ID IS NOT AN AUTHORISATION ───────────────────────────────────────────
 *
 * Three ids arrive from a POST anyone can send. The lot is checked against the
 * org and against the event in the URL here, and `setOverride` checks it
 * against the catalogue's own event again before it writes — the second is not
 * redundant, it is the check that stays true if this route ever gains another
 * caller.
 *
 * `decided_by` is the gate identity. A human's decision written as null would
 * read as an unconfirmed machine proposal the day the vision model proposes a
 * frame (src/lib/data/actor.ts).
 */
export async function placePartAction(
  eventId: string,
  lotId: string,
  field: string,
  frame: OverrideFrame,
): Promise<PlaceResult> {
  const trimmed = typeof field === "string" ? field.trim() : "";
  if (!trimmed || trimmed.length > MAX_FIELD) {
    return { ok: false, message: "That part has no field to save against." };
  }
  // REBUILT BY THE ENGINE'S OWN READER, not spread. The argument is typed, and
  // a type is a promise about the caller rather than about the POST — anything
  // can arrive here. `frameFromValue` takes `unknown`, returns the four numbers
  // or nothing, and drops every other key on the way through, so a `hidden`
  // riding in on the back of a drag never reaches the patch.
  const placed = frameFromValue(frame);
  if (!placed || !intersectsPage(placed)) {
    return { ok: false, message: "That would put the part off the page, so nothing was saved." };
  }

  const orgId = await currentOrgId();
  const [lot, catalogue] = await Promise.all([
    getLot(orgId, lotId),
    getCatalogue(orgId, eventId),
  ]);
  if (!lot || lot.eventId !== eventId) {
    return { ok: false, message: "That lot is not in this sale." };
  }
  // READ, NOT ENSURED. A catalogue row is made when the editor opens on a sale
  // with lots (../page.tsx says why the workflow depends on that), so a drag
  // always has one. Making one here would let a POST create the row the
  // workflow reads as "this sale has been laid out".
  if (!catalogue) {
    return { ok: false, message: "This sale has no catalogue yet." };
  }

  const decidedBy = await currentActorId(orgId);
  const done = await setOverride(orgId, catalogue.id, lotId, trimmed, { frame: placed }, decidedBy);
  if (!done) return { ok: false, message: "That part could not be placed in this catalogue." };

  // The editor re-derives from the row, and the lot page lists what this
  // catalogue decides about the lot.
  revalidatePath(`/events/${eventId}/catalogue`);
  revalidatePath(`/events/${eventId}/lots/${lotId}`);
  return { ok: true };
}
