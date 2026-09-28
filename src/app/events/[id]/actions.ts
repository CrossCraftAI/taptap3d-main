"use server";

import { revalidatePath } from "next/cache";

import { currentActorId } from "@/lib/data/actor";
import { setStageOverride } from "@/lib/data/events";
import { MAX_PLACE, logMovements } from "@/lib/data/movements";
import { currentOrgId } from "@/lib/data/org";
import type { MoveResult } from "@/lib/forms";
import { workflowOf } from "@/lib/data/workflow";

/**
 * Set where the sale is by hand, or go back to what the data says.
 *
 * `stage` is a stage id from the org's workflow, or blank for "derived". It is
 * checked against the WORKFLOW, not against an enum: a house-authored workflow
 * has its own ids and this action must not need to know them. An id the
 * workflow does not have is refused by writing nothing — never by writing null,
 * because a person who posted a stale option did not ask to revert.
 *
 * Every ledger that shows a stage is revalidated. The three function-first
 * places list the same events with the same column.
 */
export async function setStageAction(
  eventId: string,
  formData: FormData,
): Promise<void> {
  const orgId = await currentOrgId();
  const raw = String(formData.get("stage") ?? "").trim();
  const workflow = await workflowOf(orgId);
  const stage = raw === "" ? null : workflow.stages.find((s) => s.id === raw)?.id;
  if (stage === undefined) return;

  await setStageOverride(orgId, eventId, stage);

  // TWO PATHS, WHERE THERE WERE FOUR. `/catalogues` and `/exports` were the
  // same table as `/` and each needed telling separately; one ledger means one
  // path to invalidate, and a screen that reads the stage cannot be forgotten
  // here because there is only the one.
  revalidatePath("/");
  revalidatePath(`/events/${eventId}`);
}

/**
 * Move a chosen set of lots, in one gesture.
 *
 * ── WHY THIS EXISTS BESIDE THE CRATE OPTION THAT ALREADY DID ───────────────
 *
 * The lot's own movement form can already move "everything standing where this
 * is standing" — a crate, resolved on the server from the chain. That answers
 * "all of those over there". It cannot answer "these twelve", because the
 * twelve a registrar is about to pack are by definition NOT yet in the same
 * place: that is what packing them means.
 *
 * So the two are complementary and neither is the other with a filter. This
 * one takes the ids the pointer picked, and every guard the per-lot writer has
 * applies unchanged — `logMovements` checks each id against the org and the
 * event itself, because a list of ids off a request is not an authorisation.
 *
 * ── THE ORIGIN IS NOT ASKED FOR, AND THAT IS THE POINT OF THE PLURAL ───────
 *
 * Twelve lots picked off an index came from wherever each of them was
 * standing. `logMovements` resolves each one's own last `to_place` in the same
 * statement; a single origin typed into this form would write a fact that is
 * false for most of them. The whole set shares one `occurred_at` to the
 * microsecond, which is what makes it one gesture rather than twelve.
 */
export async function moveLotsAction(
  eventId: string,
  lotIds: readonly string[],
  formData: FormData,
): Promise<MoveResult> {
  const orgId = await currentOrgId();
  const toPlace = String(formData.get("toPlace") ?? "").trim();
  if (!toPlace) {
    return { ok: false, message: "Say where they went." };
  }
  if (lotIds.length === 0) {
    return { ok: false, message: "Nothing was selected." };
  }

  const written = await logMovements(
    orgId,
    eventId,
    lotIds,
    {
      toPlace: toPlace.slice(0, MAX_PLACE),
      custodian: String(formData.get("custodian") ?? "").slice(0, MAX_PLACE),
      reason: String(formData.get("reason") ?? "").slice(0, MAX_PLACE),
    },
    await currentActorId(orgId),
  );

  // The sale's index shows no location, but the two registers that do are one
  // press away and a stale answer there is the one somebody would act on.
  revalidatePath(`/events/${eventId}`);
  revalidatePath(`/events/${eventId}/movement`);
  if (written === 0) {
    return { ok: false, message: "Nothing moved — none of those lots is in this sale." };
  }
  return {
    ok: true,
    message: `${written} ${written === 1 ? "lot is" : "lots are"} at ${toPlace} now.`,
  };
}
