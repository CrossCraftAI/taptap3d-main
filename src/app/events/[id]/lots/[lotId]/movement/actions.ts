"use server";

import { revalidatePath } from "next/cache";

import { currentActorId } from "@/lib/data/actor";
import { getLot } from "@/lib/data/lots";
import {
  getMovement,
  logMovements,
  MAX_NOTE,
  MAX_PLACE,
  setMovementPublic,
} from "@/lib/data/movements";
import { currentOrgId } from "@/lib/data/org";
import type { LotFormState } from "@/lib/forms";

/**
 * The movement screen's writers, and there are only two of them.
 *
 * ── THERE IS NO EDIT, AND THERE IS NO DELETE ────────────────────────────────
 *
 * A leg records that a thing moved. Correcting where a lot is APPENDS another
 * movement — "it is not at the saleroom, it is still in Kwai Chung", dated when
 * somebody noticed — so both readings stay and the derived location is simply
 * the newer one. An edit would rewrite a record that exists in order to be
 * argued from, and would leave no trace that anything had been different; a
 * delete would do it more thoroughly. src/lib/data/movements.ts carries the
 * argument.
 *
 * The one thing that IS editable is `is_public`, because that is a decision
 * about the CATALOGUE rather than about custody: the leg happened either way,
 * and the tick only says whether a bidder is told.
 */

async function ownLot(eventId: string, lotId: string): Promise<string | null> {
  const orgId = await currentOrgId();
  const lot = await getLot(orgId, lotId);
  return lot && lot.eventId === eventId ? orgId : null;
}

function refresh(eventId: string, lotId: string): void {
  revalidatePath(`/events/${eventId}/lots/${lotId}/movement`);
  revalidatePath(`/events/${eventId}/movement`);
  // The condition screen names the handoff an examination is filed on, so a
  // new leg changes what that screen can offer.
  revalidatePath(`/events/${eventId}/lots/${lotId}/condition`);
}

/**
 * Log a move — of this lot, or of everything standing where it is standing.
 *
 * ── WHY THE CRATE OPTION IS ON THIS FORM AND NOT A SCREEN OF ITS OWN ────────
 *
 * "Move everything in Crate HK-114" is the same gesture as "move this lot",
 * with a different set of lots, and a crate is a place rather than an object —
 * so there is nowhere else for the gesture to live. The set is resolved on the
 * server from the lots whose LAST movement points at the same place, which is
 * the derivation the whole design rests on; the form never sends forty ids.
 *
 * Scoped to THIS EVENT even when it moves a crate. A crate can hold two sales'
 * lots and physically that is one crate — but a screen inside one sale that
 * silently wrote rows against another sale's lots would be a gesture whose
 * reach the person could not see. Named rather than hidden: the count on the
 * button is the count within this sale, and it is what gets moved.
 */
export async function logMovementAction(
  eventId: string,
  lotId: string,
  /** Every lot of this sale standing in the same place, this one included. */
  together: readonly string[],
  _previous: LotFormState,
  formData: FormData,
): Promise<LotFormState> {
  const orgId = await ownLot(eventId, lotId);
  if (!orgId) return { ok: false, message: "That lot is not in this sale.", at: Date.now() };

  const toPlace = String(formData.get("toPlace") ?? "").trim();
  if (!toPlace) {
    return {
      ok: false,
      message: "Say where it went. A movement with no destination is not a movement.",
      at: Date.now(),
    };
  }
  const asGroup = formData.get("asGroup") === "on";
  const lotIds = asGroup && together.length > 0 ? together : [lotId];

  const written = await logMovements(
    orgId,
    eventId,
    lotIds,
    {
      toPlace: toPlace.slice(0, MAX_PLACE),
      custodian: String(formData.get("custodian") ?? "").slice(0, MAX_PLACE),
      reason: String(formData.get("reason") ?? "").slice(0, MAX_PLACE),
      note: String(formData.get("note") ?? "").slice(0, MAX_NOTE),
      isPublic: formData.get("isPublic") === "on",
    },
    await currentActorId(orgId),
  );

  refresh(eventId, lotId);
  if (written === 0) {
    return { ok: false, message: "Nothing moved — that lot is not in this sale.", at: Date.now() };
  }
  return {
    ok: true,
    message:
      written === 1
        ? `Logged. It is at ${toPlace} now, because that is the last thing the chain says.`
        : `Logged for ${written} lots in one gesture. They are all at ${toPlace} now.`,
    at: Date.now(),
  };
}

/**
 * Print this leg as provenance, or stop printing it.
 *
 * A PLAIN FORM ACTION, with no state to report back: the page re-renders, the
 * tag on the leg changes and the provenance box above gains or loses a line.
 * The gesture acknowledges itself, so a sentence saying it worked would be a
 * sentence on every one of a dozen legs.
 */
export async function setProvenanceAction(
  eventId: string,
  lotId: string,
  movementId: string,
  formData: FormData,
): Promise<void> {
  const orgId = await ownLot(eventId, lotId);
  if (!orgId) return;
  const leg = await getMovement(orgId, movementId);
  // The leg must be THIS lot's. An id from a request is not an authorisation,
  // and a tick applied to another lot's chain would change what that lot's
  // catalogue prints with nobody having opened its screen.
  if (!leg || leg.lotId !== lotId) return;

  await setMovementPublic(
    orgId,
    movementId,
    formData.get("isPublic") === "on",
    await currentActorId(orgId),
  );
  refresh(eventId, lotId);
  // The catalogue prints provenance from these rows, so its preview is stale.
  revalidatePath(`/events/${eventId}/catalogue`);
}
