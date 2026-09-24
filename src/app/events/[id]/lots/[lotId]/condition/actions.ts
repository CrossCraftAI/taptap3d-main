"use server";

import { revalidatePath } from "next/cache";

import { currentActorId } from "@/lib/data/actor";
import {
  addMark,
  createExamination,
  deleteMark,
  examinationInLot,
  markInLot,
  setMarkNote,
  setReferenceView,
  updateExamination,
} from "@/lib/data/examinations";
import { getLot } from "@/lib/data/lots";
import { currentOrgId } from "@/lib/data/org";
import type { LotFormState, PlaceResult } from "@/lib/forms";

/**
 * The condition screen's writers.
 *
 * ── TWO SHAPES OF ANSWER, AND THE REASON IS THE GESTURE ─────────────────────
 *
 * A FORM gets a `LotFormState`: a person pressed a button and is owed a
 * sentence. A TAP gets a `PlaceResult`, which can only refuse — placing a mark
 * acknowledges itself, because the ring appears where the finger went, and a
 * "Saved." beside it would be noise on every one of forty marks. That is the
 * same distinction src/lib/forms.ts already draws for a drag.
 *
 * ── EVERY ONE RE-CHECKS THE CHAIN OF OWNERSHIP ──────────────────────────────
 *
 * Up to four ids arrive from the request — event, lot, examination, mark — and
 * not one of them is an authorisation. Each writer walks the chain it needs:
 * the lot is the org's and this event's, the examination is that lot's, the
 * mark is that examination's. The data layer refuses a second time on its own
 * scoping, which is belt and braces on the one path where a mistake is another
 * house's condition record.
 */

const MAX_NOTE = 4_000;
const MAX_NAME = 120;

async function ownLot(eventId: string, lotId: string): Promise<string | null> {
  const orgId = await currentOrgId();
  const lot = await getLot(orgId, lotId);
  return lot && lot.eventId === eventId ? orgId : null;
}

/** Everything that shows a condition state for this lot. */
function refresh(eventId: string, lotId: string): void {
  revalidatePath(`/events/${eventId}/lots/${lotId}/condition`);
  revalidatePath(`/events/${eventId}/condition`);
}

/**
 * Open an examination.
 *
 * ── WHY THE OCCASION IS A HANDOFF OR NOTHING ────────────────────────────────
 *
 * `movement` is a leg of this lot's chain, or empty for a standing check. Those
 * are the only two, because `examinations.movement_id` is the nullable column
 * that makes the per-handoff document and the lifetime history one table. A
 * free-text "occasion" beside it would be a third answer that neither the
 * chain nor the report could read.
 */
export async function openExaminationAction(
  eventId: string,
  lotId: string,
  _previous: LotFormState,
  formData: FormData,
): Promise<LotFormState> {
  const orgId = await ownLot(eventId, lotId);
  if (!orgId) return { ok: false, message: "That lot is not in this sale.", at: Date.now() };

  const movement = String(formData.get("movement") ?? "").trim();
  const id = await createExamination(
    orgId,
    eventId,
    lotId,
    {
      movementId: movement === "" ? null : movement,
      examiner: String(formData.get("examiner") ?? "").slice(0, MAX_NAME),
      light: String(formData.get("light") ?? "").slice(0, MAX_NAME),
      summary: String(formData.get("summary") ?? "").slice(0, MAX_NOTE),
    },
    await currentActorId(orgId),
  );
  if (!id) {
    return {
      ok: false,
      message: "That handoff is not on this lot's chain.",
      at: Date.now(),
    };
  }
  refresh(eventId, lotId);
  // NO MESSAGE ON SUCCESS, and the empty one is the honest answer rather than
  // a shrug. This said "Examination opened. Tap the object to mark what you
  // can see." and no eye ever read it: the paragraph carrying it belongs to
  // the opener FORM, and the revalidation that follows replaces that form with
  // the workbench. The sentence was written, returned, and destroyed in the
  // same frame — found by a driven test waiting five seconds for it.
  //
  // Both halves of it already exist where they can be read. The workbench IS
  // the confirmation: it appears carrying the examiner's name and the light.
  // And its empty state carries the instruction — "Nothing marked on the front
  // yet. Tap the object where a…" — beside the thing to tap, which is where an
  // instruction belongs rather than in a strip above it.
  //
  // The paragraph stays for the refusals above, which DO survive, because the
  // form is still there when one is returned.
  return { ok: true, message: "", at: Date.now() };
}

/** Change what the examination SAYS. The marks are their own writers. */
export async function saveExaminationAction(
  eventId: string,
  lotId: string,
  examinationId: string,
  _previous: LotFormState,
  formData: FormData,
): Promise<LotFormState> {
  const orgId = await ownLot(eventId, lotId);
  if (!orgId) return { ok: false, message: "That lot is not in this sale.", at: Date.now() };
  if (!(await examinationInLot(orgId, lotId, examinationId))) {
    return { ok: false, message: "That examination is not this lot's.", at: Date.now() };
  }

  await updateExamination(
    orgId,
    examinationId,
    {
      examiner: String(formData.get("examiner") ?? "").slice(0, MAX_NAME),
      light: String(formData.get("light") ?? "").slice(0, MAX_NAME),
      summary: String(formData.get("summary") ?? "").slice(0, MAX_NOTE),
    },
    await currentActorId(orgId),
  );
  refresh(eventId, lotId);
  return { ok: true, message: "Saved. The report prints it this way.", at: Date.now() };
}

/**
 * Put a mark on the view.
 *
 * `x` and `y` are fractions of the REFERENCE VIEW, computed by the viewer from
 * the box it measured. The server clamps them rather than refusing
 * (src/lib/data/examinations.ts, `clampFraction`): a pointer landing a pixel
 * outside the box is a hand, not an attack, and a fault that would not save is
 * a fault that does not get recorded.
 */
export async function addMarkAction(
  eventId: string,
  lotId: string,
  examinationId: string,
  view: string,
  x: number,
  y: number,
): Promise<PlaceResult> {
  const orgId = await ownLot(eventId, lotId);
  if (!orgId) return { ok: false, message: "That lot is not in this sale." };
  if (!(await examinationInLot(orgId, lotId, examinationId))) {
    return { ok: false, message: "That examination is not this lot's." };
  }
  const id = await addMark(orgId, examinationId, { view, x, y });
  if (!id) return { ok: false, message: "That is not a view this build can mark up." };
  refresh(eventId, lotId);
  return { ok: true };
}

/** What the examiner saw there. Prose, and the only thing a mark carries. */
export async function setMarkNoteAction(
  eventId: string,
  lotId: string,
  markId: string,
  note: string,
): Promise<PlaceResult> {
  const orgId = await ownLot(eventId, lotId);
  if (!orgId) return { ok: false, message: "That lot is not in this sale." };
  if (!(await markInLot(orgId, lotId, markId))) {
    return { ok: false, message: "That mark is not this lot's." };
  }
  await setMarkNote(orgId, markId, note.slice(0, MAX_NOTE));
  refresh(eventId, lotId);
  return { ok: true };
}

/**
 * Remove a mark.
 *
 * The one destructive gesture in this phase, and it is bounded to a mark. A
 * mark placed by a slip of a finger on a tablet is not an observation; an
 * examination is, and nothing here deletes one.
 */
export async function deleteMarkAction(
  eventId: string,
  lotId: string,
  markId: string,
): Promise<PlaceResult> {
  const orgId = await ownLot(eventId, lotId);
  if (!orgId) return { ok: false, message: "That lot is not in this sale." };
  if (!(await markInLot(orgId, lotId, markId))) {
    return { ok: false, message: "That mark is not this lot's." };
  }
  await deleteMark(orgId, markId);
  refresh(eventId, lotId);
  return { ok: true };
}

/**
 * Say which of the lot's photographs IS a view.
 *
 * An empty choice CLEARS it, in the same control, because an automatic or human
 * value a person cannot get back from is a defect whatever it is worth
 * (principle 9). Clearing does not move a single mark: the marks are fractions
 * of the view, and the view is a box, not a file.
 */
export async function setReferenceViewAction(
  eventId: string,
  lotId: string,
  examinationId: string,
  _previous: LotFormState,
  formData: FormData,
): Promise<LotFormState> {
  const orgId = await ownLot(eventId, lotId);
  if (!orgId) return { ok: false, message: "That lot is not in this sale.", at: Date.now() };
  if (!(await examinationInLot(orgId, lotId, examinationId))) {
    return { ok: false, message: "That examination is not this lot's.", at: Date.now() };
  }
  const view = String(formData.get("view") ?? "");
  const assetId = String(formData.get("assetId") ?? "").trim();
  const done = await setReferenceView(orgId, examinationId, view, assetId || null);
  refresh(eventId, lotId);
  return done
    ? {
        ok: true,
        message: assetId
          ? "That photograph stands for this view now. The marks have not moved."
          : "No photograph stands for this view. The marks have not moved.",
        at: Date.now(),
      }
    : { ok: false, message: "That photograph is not this house's.", at: Date.now() };
}
