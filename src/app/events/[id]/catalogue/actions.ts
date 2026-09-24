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
  return writeFrame(eventId, lotId, field, frame);
}

/**
 * Put a part back: to where it was before one placement, or to the engine.
 *
 * ── ONE WRITER, TWO SENTENCES ───────────────────────────────────────────────
 *
 * Undo and Reset are the same write with two different arguments, and they are
 * one action for the reason `placePartAction` is one function: the patch is the
 * dangerous part, and a second copy of "send `frame` and nothing else" is how a
 * later change to one of them quietly starts erasing the typo somebody fixed on
 * the same (lot, field). The caller decides the value; this decides nothing.
 *
 *   frame  — the rectangle this part occupied before the placement being undone
 *   null   — no rectangle at all, i.e. hand the part back to the engine
 *
 * NULL IS EXPLICIT AND IS NOT THE SAME AS ABSENT. `mergeOverride` deletes a key
 * whose patch value is null and ignores one that is undefined
 * (src/lib/data/overrides.ts), so `{ frame: null }` is the only way to say "the
 * engine places this again" — and when it is the last judgement in the row, the
 * row goes with it and the lot stops carrying an override it no longer has.
 *
 * THE ROW IS NOT ENSURED HERE, and that is the difference from a placement.
 * Clearing a frame is not a layout decision; it is the withdrawal of one. A
 * catalogue that does not exist has no frame to clear, so there is nothing to
 * make and nothing to say beyond a refusal the caller can print.
 */
export async function restorePartFrameAction(
  eventId: string,
  lotId: string,
  field: string,
  frame: OverrideFrame | null,
): Promise<PlaceResult> {
  return writeFrame(eventId, lotId, field, frame);
}

/**
 * The one place a frame is written, for both of the exported actions above.
 *
 * Not exported: a `"use server"` module's exports are POST endpoints, and this
 * takes a nullable frame that means "clear". Two named actions in front of it
 * are two sentences a caller can read; one endpoint taking a nullable would be
 * an endpoint whose meaning depends on a value.
 */
async function writeFrame(
  eventId: string,
  lotId: string,
  field: string,
  frame: OverrideFrame | null,
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
  const placed = frame === null ? null : frameFromValue(frame);
  if (frame !== null && (!placed || !intersectsPage(placed))) {
    return { ok: false, message: "That would put the part off the page, so nothing was saved." };
  }

  const orgId = await currentOrgId();
  const lot = await getLot(orgId, lotId);
  if (!lot || lot.eventId !== eventId) {
    return { ok: false, message: "That lot is not in this sale." };
  }
  // ENSURED, AND THAT IS A REVERSAL WORTH READING. This said READ, NOT
  // ENSURED, on the argument that the editor's own page made the row when it
  // opened, so a drag always had one — and that making one here would let a
  // POST create the row the workflow reads as "this sale has been laid out".
  //
  // The premise went first: ../page.tsx no longer makes a row on open, because
  // a GET that advances a sale's stage is the worse of the two problems. With
  // it gone, the first drag on a fresh sale found no catalogue and was refused
  // with "This sale has no catalogue yet" — a sentence about an implementation
  // detail, in answer to a gesture that had nothing wrong with it.
  //
  // And the conclusion inverts with it. DRAGGING A PART IS LAYING OUT. It is
  // the same class of act as choosing a template or pinning two lots, and
  // those two both make the row for exactly that reason. The rule that comes
  // out of this is the clean one: the row is made by the gestures that ARE
  // layout decisions, and by no read at all.
  //
  // CLEARING IS THE EXCEPTION, and it is the same rule read backwards. Undo and
  // Reset withdraw a layout decision rather than making one, so they READ the
  // row: a sale with no catalogue has no frame to clear, and making one in
  // order to clear nothing would be a GET-shaped write arriving through a
  // button — the defect ../page.tsx's header describes, by a different door.
  const catalogue =
    placed === null
      ? await getCatalogue(orgId, eventId)
      : await ensureCatalogue(orgId, eventId);
  if (!catalogue) {
    return { ok: false, message: "This sale has no catalogue, so there is nothing to put back." };
  }

  const decidedBy = await currentActorId(orgId);
  const done = await setOverride(orgId, catalogue.id, lotId, trimmed, { frame: placed }, decidedBy);
  // A CLEAR THAT FOUND NOTHING IS NOT A FAILURE. `setOverride` answers false
  // when the row was already absent — which is exactly the state a reset is
  // asking for — so only a write that was meant to leave something behind can
  // report that it did not.
  if (!done && placed !== null) {
    return { ok: false, message: "That part could not be placed in this catalogue." };
  }

  // The editor re-derives from the row, and the lot page lists what this
  // catalogue decides about the lot.
  revalidatePath(`/events/${eventId}/catalogue`);
  revalidatePath(`/events/${eventId}/lots/${lotId}`);
  return { ok: true };
}
