"use client";

import { useActionState } from "react";

import { saveLotFieldsAction } from "@/app/events/[id]/lots/[lotId]/actions";
import { IDLE_LOT_FORM, type LotFormState } from "@/lib/forms";
import { logAction } from "@/lib/log/client";

export interface FieldRow {
  key: string;
  /** What the person reads. The house's own header for a custom column. */
  label: string;
  /** Under the label: the English name of a core field, or where a column came from. */
  hint?: string;
  value: string;
  /**
   * A textarea rather than a one-line input. Decided by the SHAPE of the value
   * — how long it is — and never by the key, because the long text in a real
   * sale arrives under whatever column the house happened to call it.
   */
  long: boolean;
}

/**
 * The record, editable.
 *
 * ── UNCONTROLLED INPUTS, RESET BY REMOUNT ────────────────────────────────────
 *
 * The catalogue controls had to become controlled because they submit every
 * field on every change, so a stale DOM value posted itself back over a fresh
 * server one. Nothing here submits on change: there is one Save, and what the
 * DOM holds at that moment is exactly what the person wants written. So the
 * inputs are plain `defaultValue` inputs, and authority returns to the server
 * the same way as in the controls — by REMOUNTING the body on the record's
 * version, which the page passes from `lots.updated_at`. When the save lands
 * the body is new and every default is the server's answer, including the
 * trimmed values and the vanished blank keys.
 *
 * The status line lives OUTSIDE the remounted body, or it would be reset in the
 * same instant it had something to say.
 *
 * No input disables itself while saving. A disabled input is blurred by the
 * browser and eats the keystrokes typed into it — the predecessor lost `-1.37`
 * to exactly that — and a person who keeps typing during a save should lose
 * nothing but the round trip.
 */
export function LotFieldsForm({
  eventId,
  lotId,
  rows,
  version,
}: {
  eventId: string;
  lotId: string;
  rows: FieldRow[];
  version: number;
}): React.ReactElement {
  const [state, action, pending] = useActionState<LotFormState, FormData>(
    saveLotFieldsAction.bind(null, eventId, lotId),
    IDLE_LOT_FORM,
  );

  return (
    <form
      action={action}
      onSubmit={() => logAction("lot.fields.save", { lotId })}
      className="mt-3 border border-rule bg-paper"
    >
      <FieldsBody key={version} rows={rows} />
      <div className="flex items-center justify-between gap-4 border-t border-rule bg-field px-4 py-2.5">
        <p
          key={state.at}
          role="status"
          aria-live="polite"
          className={`min-w-0 text-[12px] ${state.ok ? "text-muted" : "text-seal"}`}
        >
          {state.message}
        </p>
        <button
          type="submit"
          disabled={pending}
          className="shrink-0 bg-seal px-3 py-1.5 text-[13px] font-medium text-white hover:bg-sealPress disabled:opacity-60"
        >
          Save fields
        </button>
      </div>
    </form>
  );
}

function FieldsBody({ rows }: { rows: FieldRow[] }): React.ReactElement {
  return (
    <div>
      {rows.map((row) => {
        const id = `field-${row.key}`;
        return (
          <div
            key={row.key}
            className="flex gap-4 border-b border-rule px-4 py-2 last:border-b-0"
          >
            <div className="w-28 shrink-0 pt-1">
              <label htmlFor={id} className="block truncate text-[12px] text-muted">
                {row.label}
              </label>
              {row.hint && (
                <span className="block truncate text-[12px] text-faint">{row.hint}</span>
              )}
            </div>
            {row.long ? (
              <textarea
                id={id}
                name={`field:${row.key}`}
                defaultValue={row.value}
                rows={3}
                className="min-w-0 flex-1 resize-y border border-rule bg-paper px-2 py-1 text-[13px] leading-relaxed"
              />
            ) : (
              <input
                id={id}
                name={`field:${row.key}`}
                defaultValue={row.value}
                className="min-w-0 flex-1 border border-rule bg-paper px-2 py-1 text-[13px]"
              />
            )}
          </div>
        );
      })}
      {/* A column of the house's own. Kept as a separate pair of inputs rather
          than an "add row" button that grows the form, so the no-JavaScript
          path can add one too. */}
      <div className="flex gap-4 border-t border-rule bg-field px-4 py-2">
        <input
          name="newKey"
          aria-label="New column name"
          placeholder="new column"
          className="w-28 shrink-0 border border-rule bg-paper px-2 py-1 text-[12px]"
        />
        <input
          name="newValue"
          aria-label="New column value"
          placeholder="its value for this lot"
          className="min-w-0 flex-1 border border-rule bg-paper px-2 py-1 text-[13px]"
        />
      </div>
    </div>
  );
}
