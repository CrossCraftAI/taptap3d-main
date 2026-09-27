"use server";

// How a treatment reaches the row.
//
// ── WHY IT IS HERE AND NOT BESIDE THE EDITOR'S OTHER ACTIONS ────────────────
//
// `placePartAction` and `setCatalogueParamsAction` live in
// src/app/events/[id]/catalogue/actions.ts, which is the natural neighbour and
// is another agent's file this cycle. Putting a seventh action into it would
// have been a merge conflict in the one file two tranches both want, so this
// sits beside the panel's own model instead — which is also the honest
// arrangement: the panel and its writer are one feature, and the editor's page
// binds them together rather than owning them.
//
// Everything about the shape is copied from `placePartAction` DELIBERATELY,
// including the order of the guards, so the two read the same and a reviewer
// checking one has checked both: an id is not an authorisation, the lot is
// checked against the org and the event before the data layer checks it again
// against the catalogue's event, the patch is rebuilt rather than spread, and
// `decided_by` records a person so the row cannot be mistaken for a machine's
// unconfirmed proposal.

import { revalidatePath } from "next/cache";

import { currentActorId } from "@/lib/data/actor";
import { ensureCatalogue } from "@/lib/data/catalogues";
import { getLot } from "@/lib/data/lots";
import { currentOrgId } from "@/lib/data/org";
import { setOverride } from "@/lib/data/overrides";
import { PLATE_FIELD, patchIsEmpty, platePatchFromValue } from "@/lib/polish/panel-model";
import type { PlaceResult } from "@/lib/forms";

/**
 * Treat one lot's plate in this catalogue.
 *
 * ── IT TAKES NO FIELD, AND THAT IS THE GUARD ───────────────────────────────
 *
 * `placePartAction` takes a field because any part of an entry can be dragged.
 * A treatment is only ever about the photograph, so the field is not a
 * parameter here — it is the constant `PLATE_FIELD`, and there is therefore no
 * value a caller can send that would write a ground against a lot's title. A
 * validated field parameter would be the same protection with one more thing to
 * get right.
 *
 * ── AND IT MAKES THE CATALOGUE ROW ─────────────────────────────────────────
 *
 * `ensureCatalogue`, for the reason `placePartAction` reversed itself to: the
 * row is made by the gestures that ARE layout decisions and by no read at all.
 * Choosing how a plate prints in this catalogue is such a gesture — it is the
 * same class of act as choosing a template — so a specialist's first polish on
 * a fresh sale must not be refused with a sentence about an implementation
 * detail.
 */
export async function polishPlateAction(
  eventId: string,
  lotId: string,
  patch: unknown,
): Promise<PlaceResult> {
  const cleaned = platePatchFromValue(patch);
  if (patchIsEmpty(cleaned)) {
    return { ok: false, message: "There was nothing in that change to save." };
  }

  const orgId = await currentOrgId();
  const lot = await getLot(orgId, lotId);
  if (!lot || lot.eventId !== eventId) {
    return { ok: false, message: "That lot is not in this sale." };
  }
  const catalogue = await ensureCatalogue(orgId, eventId);
  const decidedBy = await currentActorId(orgId);
  const done = await setOverride(
    orgId,
    catalogue.id,
    lotId,
    PLATE_FIELD,
    cleaned,
    decidedBy,
  );
  if (!done) {
    // `setOverride` answers false for a lot outside this catalogue's event AND
    // for a merge that left nothing to assert on a row that did not exist —
    // pressing 原狀 on a plate nobody had treated. The second is not an error
    // and the first cannot happen after the check above, so the sentence says
    // what is true of both: the page did not change.
    return { ok: false, message: "That plate already prints as supplied." };
  }

  // The editor re-derives from the row, and the lot page lists what this
  // catalogue decides about the lot.
  revalidatePath(`/events/${eventId}/catalogue`);
  revalidatePath(`/events/${eventId}/lots/${lotId}`);
  return { ok: true };
}
