"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";

import { logMovementAction } from "@/app/events/[id]/lots/[lotId]/movement/actions";
import { IDLE_LOT_FORM, type LotFormState } from "@/lib/forms";
import { logAction } from "@/lib/log/client";

/**
 * Where it is, and the one gesture that changes the answer.
 *
 * ── THE BAR READS A DERIVATION, SO IT CANNOT BE EDITED ──────────────────────
 *
 * "Saleroom, Wong Chuk Hang" is the last movement's destination, computed on
 * every read. There is no field to change it, and "Correct this" does not open
 * one: it opens the same form that logs any other move, with the reason
 * already filled in. That is the whole shape of the feature — the correction
 * and the move are one kind of thing, and the chain keeps both.
 *
 * It is the fourth use of "derived by default, a person may overrule" in this
 * codebase — the workflow stage, the catalogue's overrides, the engine's
 * placements, and this — and the one that most obviously could have been a
 * column. ARCHITECTURE.md principle 2 says why it is not.
 *
 * ── THE CRATE IS A CHECKBOX, BECAUSE A CRATE IS A PLACE ─────────────────────
 *
 * Forty lots standing in the same place move as one gesture, and the set is
 * resolved on the server from the chain rather than sent from here. The
 * checkbox appears only when there is somebody to move WITH — an option that
 * would move one lot is an option that says nothing.
 */
export function MovementLogger({
  eventId,
  lotId,
  place,
  custodian,
  since,
  /** Lots of this sale standing in the same place, this one included. */
  together,
  /** Places this house has actually used, for the suggestion list. */
  places,
}: {
  eventId: string;
  lotId: string;
  /** Null means nowhere recorded — which is not the same as lost. */
  place: string | null;
  custodian: string | null;
  /** Formatted on the server: a client that formats a date rehydrates another. */
  since: string | null;
  together: readonly string[];
  places: readonly string[];
}): React.ReactElement {
  const [state, action, pending] = useActionState<LotFormState, FormData>(
    logMovementAction.bind(null, eventId, lotId, together),
    IDLE_LOT_FORM,
  );
  const [open, setOpen] = useState(place === null);
  const [reason, setReason] = useState("");
  const destination = useRef<HTMLInputElement>(null);
  const listId = useId();
  const groupSize = together.length;

  // ── THE FORM PUTS ITSELF AWAY, AND ITS FIELDS ARE THE SERVER'S AGAIN ──────
  //
  // A server action re-renders the page, and a client component's STATE
  // survives that — so without this, logging a move left the form open with
  // the destination still typed in it and the bar above it already reading
  // somewhere else. The next person to press the button would have logged the
  // same leg twice.
  //
  // Keyed on the answer's timestamp rather than on the place, because a
  // correction that lands on the SAME place is still a save and still has to
  // clear. `state.at` changes on every answer (src/lib/forms.ts says why it
  // exists), and the ref makes this run once per answer instead of on every
  // render that happens to carry one.
  const handled = useRef(0);
  useEffect(() => {
    if (!state.ok || !state.message || state.at === handled.current) return;
    handled.current = state.at;
    setReason("");
    setOpen(false);
  }, [state]);

  const correct = (): void => {
    setReason("Correction");
    setOpen(true);
    // Focus after the panel exists. A control that reveals a form and leaves
    // the caret where it was makes the person hunt for what just appeared.
    window.requestAnimationFrame(() => destination.current?.focus());
  };

  return (
    // NAMED, so it is a landmark rather than a generic <section>. A bare
    // <section> has no role at all, and this is the one part of the screen a
    // reader comes back to.
    <section aria-label="Where it is" className="mt-6 border border-rule bg-paper">
      <div className="flex flex-wrap items-end justify-between gap-4 px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-[10px] font-semibold uppercase tracking-wide text-faint">
            Where it is
          </h2>
          {place === null ? (
            <>
              <p className="mt-1 text-[15px] font-medium text-muted">
                Nowhere recorded
              </p>
              <p className="mt-1 text-[12px] leading-relaxed text-faint">
                No movement has ever been logged for this lot. That is not the
                same as lost — it means nobody has said, and nothing was
                invented on its behalf.
              </p>
            </>
          ) : (
            <>
              <p className="mt-1 truncate text-[15px] font-medium">{place}</p>
              <p className="mt-1 text-[12px] text-faint" data-numeric>
                derived from the last movement
                {custodian ? ` · ${custodian} has it` : ""}
                {since ? ` · since ${since}` : ""}
                {groupSize > 1 ? ` · with ${groupSize - 1} more from this sale` : ""}
              </p>
            </>
          )}
        </div>
        <button
          type="button"
          onClick={correct}
          className="min-h-[var(--tap)] shrink-0 border border-ruleStrong bg-paper px-3 text-[12px] font-medium hover:bg-sunk"
        >
          {place === null ? "Log where it is" : "Correct this"}
        </button>
      </div>

      {/* OUTSIDE THE FORM, or it would be removed in the same instant it had
          something to say — the form closes on a successful log. The same
          arrangement, and the same reason, as the lot form's status line. */}
      {state.message && (
        <p
          key={state.at}
          role="status"
          aria-live="polite"
          className={`border-t border-rule px-4 py-2 text-[12px] ${
            state.ok ? "text-muted" : "text-seal"
          }`}
        >
          {state.message}
        </p>
      )}

      {open && (
        <form
          // REMOUNTED ON EVERY ANSWER, so the fields are the server's again
          // rather than whatever was typed a moment ago. Uncontrolled inputs
          // keep their DOM values across a re-render; this is what returns
          // authority to the server, exactly as the lot form does it.
          key={state.at}
          action={action}
          onSubmit={() => logAction("movement.log", { lotId })}
          className="border-t border-rule bg-field px-4 py-3"
        >
          <p className="text-[12px] leading-relaxed text-muted">
            This appends a movement. Nothing already in the chain is rewritten —
            a wrong leg stays, and the newer one is what the location reads
            from.
          </p>

          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <Field label="To" htmlFor="toPlace">
              <input
                id="toPlace"
                name="toPlace"
                ref={destination}
                required
                list={listId}
                placeholder="a store, a studio, a crate"
                className="min-h-[var(--tap)] w-full border border-rule bg-paper px-2 text-[13px]"
              />
              {/* The places this house has used, which is a better list than
                  any vocabulary this system could ship — and it costs nothing,
                  because the register already asks the same question. */}
              <datalist id={listId}>
                {places.map((known) => (
                  <option key={known} value={known} />
                ))}
              </datalist>
            </Field>
            <Field label="Who has it" htmlFor="custodian">
              <input
                id="custodian"
                name="custodian"
                placeholder="a name, not a user"
                className="min-h-[var(--tap)] w-full border border-rule bg-paper px-2 text-[13px]"
              />
            </Field>
            <Field label="Why" htmlFor="reason">
              <input
                id="reason"
                name="reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="on receipt, pre-sale viewing, to the restorer"
                className="min-h-[var(--tap)] w-full border border-rule bg-paper px-2 text-[13px]"
              />
            </Field>
            <Field label="Note" htmlFor="note">
              <input
                id="note"
                name="note"
                placeholder="anything the next person needs"
                className="min-h-[var(--tap)] w-full border border-rule bg-paper px-2 text-[13px]"
              />
            </Field>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-4">
            {groupSize > 1 && (
              <label className="inline-flex min-h-[var(--tap)] items-center gap-2 text-[12px]">
                <input type="checkbox" name="asGroup" defaultChecked />
                <span>
                  Move all <span data-numeric>{groupSize}</span> lots of this
                  sale standing in {place}
                </span>
              </label>
            )}
            <label className="inline-flex min-h-[var(--tap)] items-center gap-2 text-[12px]">
              <input type="checkbox" name="isPublic" />
              <span>
                Print where it came from as provenance
              </span>
            </label>
          </div>

          <div className="mt-2 flex items-center justify-end gap-4">
            <div className="flex shrink-0 gap-2">
              {place !== null && (
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="min-h-[var(--tap)] border border-ruleStrong bg-paper px-3 text-[12px] hover:bg-sunk"
                >
                  Cancel
                </button>
              )}
              <button
                type="submit"
                disabled={pending}
                className="min-h-[var(--tap)] bg-seal px-3 text-[12px] font-medium text-paper hover:bg-sealPress disabled:opacity-60"
              >
                Log the movement
              </button>
            </div>
          </div>
        </form>
      )}
    </section>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div>
      <label htmlFor={htmlFor} className="block text-[12px] text-muted">
        {label}
      </label>
      <div className="mt-0.5">{children}</div>
    </div>
  );
}
