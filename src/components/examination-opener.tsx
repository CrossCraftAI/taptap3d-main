"use client";

import { useActionState } from "react";

import { openExaminationAction } from "@/app/events/[id]/lots/[lotId]/condition/actions";
import { IDLE_LOT_FORM, type LotFormState } from "@/lib/forms";
import { logAction } from "@/lib/log/client";

/** One handoff, as the occasion picker names it. */
export interface OccasionChoice {
  id: string;
  label: string;
  /** True where this leg already carries a report, which is worth saying. */
  examined: boolean;
}

/**
 * Open an examination.
 *
 * ── THE OCCASION IS A HANDOFF, OR IT IS NOTHING ─────────────────────────────
 *
 * The select offers this lot's own legs and "a standing check". Those are the
 * only two answers, because `examinations.movement_id` is the nullable column
 * that makes the per-handoff document and the lifetime history one table — a
 * free-text occasion beside it would be a third answer neither the chain nor
 * the report could read.
 *
 * A leg that already carries a report is still offered, and says so. Two people
 * genuinely examine one arrival — a registrar and a conservator — and refusing
 * the second would make the unusual case impossible rather than merely
 * unusual (src/db/schema.ts says the same about the index).
 *
 * ── EVERY EXAMINATION IS NEW; NONE IS REOPENED ──────────────────────────────
 *
 * There is no "continue the last one". An examination is dated, and a report
 * amended a fortnight later under its original date is a document that lies
 * about when somebody looked. The lifetime view is where the earlier one is
 * still read.
 */
export function ExaminationOpener({
  eventId,
  lotId,
  occasions,
  /** True when this is the first — the copy differs, and only the copy. */
  first,
}: {
  eventId: string;
  lotId: string;
  occasions: readonly OccasionChoice[];
  first: boolean;
}): React.ReactElement {
  const [state, action, pending] = useActionState<LotFormState, FormData>(
    openExaminationAction.bind(null, eventId, lotId),
    IDLE_LOT_FORM,
  );

  return (
    <form
      action={action}
      onSubmit={() => logAction("condition.open", { lotId })}
      className="border border-rule bg-paper px-4 py-4"
    >
      <h2 className="text-[15px] font-medium">
        {first ? "This lot has never been examined" : "Open a new examination"}
      </h2>
      <p className="mt-1 max-w-xl text-[13px] leading-relaxed text-muted">
        {first
          ? "An examination is a dated document: who looked, under what light, and every fault they could see. It is what travels with the crate."
          : "A new examination, dated today. The one before it is not changed — the lifetime view is where both are read."}
      </p>

      <div className="mt-3 grid max-w-xl gap-2 sm:grid-cols-2">
        <div>
          <label htmlFor="movement" className="block text-[12px] text-muted">
            Occasion
          </label>
          <select
            id="movement"
            name="movement"
            defaultValue=""
            className="mt-0.5 min-h-[var(--tap)] w-full border border-rule bg-paper px-2 text-[13px]"
          >
            <option value="">A standing check — not a handoff</option>
            {occasions.map((occasion) => (
              <option key={occasion.id} value={occasion.id}>
                {occasion.label}
                {occasion.examined ? " (already has a report)" : ""}
              </option>
            ))}
          </select>
        </div>
        {/* "Examined by" and "Under what light", not "By" and "Light". This
            form and the open examination's own form are on the screen at the
            same time, and two fields with one accessible name is a control a
            screen reader cannot distinguish and a driven test cannot address.
            The words are longer here and that is the price. */}
        <div>
          <label htmlFor="new-examiner" className="block text-[12px] text-muted">
            Examined by
          </label>
          <input
            id="new-examiner"
            name="examiner"
            placeholder="who is looking"
            className="mt-0.5 min-h-[var(--tap)] w-full border border-rule bg-paper px-2 text-[13px]"
          />
        </div>
        <div>
          <label htmlFor="new-light" className="block text-[12px] text-muted">
            Under what light
          </label>
          <input
            id="new-light"
            name="light"
            placeholder="daylight · raking · UV"
            className="mt-0.5 min-h-[var(--tap)] w-full border border-rule bg-paper px-2 text-[13px]"
          />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="new-summary" className="block text-[12px] text-muted">
            Overall
          </label>
          <textarea
            id="new-summary"
            name="summary"
            rows={2}
            placeholder="What a bidder needs to know before the marks. It can be written afterwards."
            className="mt-0.5 min-h-[var(--tap)] w-full resize-y border border-rule bg-paper px-2 py-1 text-[13px] leading-relaxed"
          />
        </div>
      </div>

      <div className="mt-3 flex items-center gap-4">
        <button
          type="submit"
          disabled={pending}
          className="min-h-[var(--tap)] bg-seal px-3 text-[13px] font-medium text-paper hover:bg-sealPress disabled:opacity-60"
        >
          Open the examination
        </button>
        <p
          key={state.at}
          role="status"
          aria-live="polite"
          className={`min-w-0 text-[12px] ${state.ok ? "text-muted" : "text-seal"}`}
        >
          {state.message}
        </p>
      </div>
    </form>
  );
}
