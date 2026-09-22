"use server";

import { revalidatePath } from "next/cache";

import { setStageOverride } from "@/lib/data/events";
import { currentOrgId } from "@/lib/data/org";
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
