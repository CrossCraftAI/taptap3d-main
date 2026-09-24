"use client";

import { useActionState } from "react";

import { saveLotFieldsAction } from "@/app/events/[id]/lots/[lotId]/actions";
import { Reach } from "@/app/events/[id]/lots/[lotId]/reach";
import type { Audience } from "@/lib/engine/visibility";
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
  /**
   * How far this value goes: the house's own answer for this field key
   * (src/lib/engine/visibility.ts), or `public` because it has not given one.
   *
   * SHOWN HERE AND ENFORCED SOMEWHERE ELSE. This badge is a label, not a
   * control and not a check — the engine drops the field, on every output, on
   * every derivation. If this line were the guard it would be a guard one
   * screen obeys, which is exactly the shape the engine exists to refuse.
   */
  level: Audience;
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
 *
 * ── THE FIELD IS THE FLOOR, NOT THE ROW AROUND IT ───────────────────────────
 *
 * Every input carries `min-h-[var(--tap)]` IN PLACE OF its own vertical
 * padding rather than on top of it, so the field's box is the token (28px with
 * a mouse, 44 under `@media (pointer: coarse)` — globals.css) instead of the
 * token plus the eight pixels it used to be padded by.
 *
 * The label column beside it is left alone: `htmlFor` already makes the words
 * focus the field, so the caption is reachable without a box of its own, and a
 * floor on every caption would push the record's rows apart for nothing.
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
          className="min-h-[var(--tap)] shrink-0 bg-seal px-3 text-[13px] font-medium text-white hover:bg-sealPress disabled:opacity-60"
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
                // The floor is a no-op on three rows of text and it is here
                // anyway: what makes it safe to change `rows` later, and the
                // one shape that does not need an exception in the census.
                className="min-h-[var(--tap)] min-w-0 flex-1 resize-y border border-rule bg-paper px-2 py-1 text-[13px] leading-relaxed"
              />
            ) : (
              <input
                id={id}
                name={`field:${row.key}`}
                defaultValue={row.value}
                className="min-h-[var(--tap)] min-w-0 flex-1 border border-rule bg-paper px-2 text-[13px]"
              />
            )}
            {/* AFTER the field, not inside the label column. That column is
                `w-28` and truncates, so "Never leaves the building" would have
                arrived as "Never lea…" on the one row where it matters most.
                Here it renders at its full width on the rare marked row and
                is not rendered at all on every other — the record of a house
                with no policy is the record it was before this landed, gap
                included. */}
            <Reach level={row.level} className="mt-1.5" />
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
          className="min-h-[var(--tap)] w-28 shrink-0 border border-rule bg-paper px-2 text-[12px]"
        />
        <input
          name="newValue"
          aria-label="New column value"
          placeholder="its value for this lot"
          className="min-h-[var(--tap)] min-w-0 flex-1 border border-rule bg-paper px-2 text-[13px]"
        />
      </div>
    </div>
  );
}
