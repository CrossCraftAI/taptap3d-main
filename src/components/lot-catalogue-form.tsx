"use client";

import { useActionState } from "react";

import { setLotOverridesAction } from "@/app/events/[id]/lots/[lotId]/actions";
import { IDLE_LOT_FORM, type LotFormState } from "@/lib/forms";
import { logAction } from "@/lib/log/client";

export interface OverrideRowSpec {
  key: string;
  label: string;
  hint?: string;
  /** What the record holds, as text. Empty when it holds nothing. */
  record: string;
  hidden: boolean;
  text: string;
  /**
   * Somebody has dragged this part to a place of their own choosing.
   *
   * It is not a control here and it is deliberately not one: a frame is four
   * fractions of a page and the only sane way to change it is to move it on
   * the page. What it IS here is VISIBLE, which it was not — the header
   * counted every override row and this table counted the two kinds it could
   * draw, so a lot with one placement said "1 field overridden in the
   * catalogue" at the top and "nothing overridden" ninety pixels below. One
   * noun, two definitions, both printed on one screen.
   */
  placed: boolean;
  /** The plate is a content hash: it can be hidden but not retyped. */
  hideOnly?: boolean;
}

/**
 * How THIS catalogue prints the lot.
 *
 * Every row shows three things side by side, because principle 9 says an
 * automatic or human correction the person cannot see is a defect: what the
 * record holds, what will actually print, and — when they differ — a mark that
 * says so. Un-ticking the box or clearing the text is the reversal; nothing else
 * has to be found.
 *
 * Same mechanics as the record's form: uncontrolled inputs, the body remounted
 * on the catalogue's version, the status line outside it.
 *
 * ── THE HIDE COLUMN IS A TICK WITH NO WORDS BESIDE IT ───────────────────────
 *
 * Everywhere else a checkbox's target is its label, because the words are the
 * obvious thing to press. Here the words are the COLUMN HEADER, one per table
 * rather than one per row, so there is nothing per-row to wrap. The target is
 * therefore a square of `--tap` in the cell, drawn as nothing and centred on
 * the box the browser paints — and it fits without widening the table: the
 * column is declared `w-14`, which is 56px, against 44 at the coarse pointer's
 * token. That is also why the cell gives up its own horizontal padding; with
 * `px-2` still on it the square would have had 40px to sit in and the column
 * would have grown to take it.
 */
export function LotCatalogueForm({
  eventId,
  lotId,
  catalogueId,
  catalogueName,
  rows,
  version,
}: {
  eventId: string;
  lotId: string;
  /** Null until a decision makes the row; the save is one. See ../app/.../actions.ts. */
  catalogueId: string | null;
  catalogueName: string;
  rows: OverrideRowSpec[];
  version: number;
}): React.ReactElement {
  const [state, action, pending] = useActionState<LotFormState, FormData>(
    setLotOverridesAction.bind(null, eventId, lotId),
    IDLE_LOT_FORM,
  );
  // THE SAME SET THE HEADER COUNTS. Anything less makes the two numbers on
  // this page disagree, which is how a person learns to believe neither.
  const overridden = rows.filter((r) => r.hidden || r.text || r.placed).length;

  return (
    <form
      action={action}
      onSubmit={() => logAction("catalogue.override.save", { lotId }, catalogueId)}
      className="mt-3 border border-rule bg-paper"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-rule px-4 py-2">
        <p className="text-[12px] text-muted">
          These decisions belong to <span className="text-ink">{catalogueName}</span> only.
          The record is untouched, and the engine re-applies them at every density.
        </p>
        <p className="text-[12px]" data-numeric>
          {overridden === 0 ? (
            <span className="text-faint">nothing overridden</span>
          ) : (
            <span className="text-seal">
              {overridden} {overridden === 1 ? "field" : "fields"} overridden
            </span>
          )}
        </p>
      </div>
      <OverridesBody key={version} rows={rows} />
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
          className="min-h-[var(--tap)] shrink-0 border border-ruleStrong bg-paper px-3 text-[13px] font-medium hover:bg-sunk disabled:opacity-60"
        >
          Apply to this catalogue
        </button>
      </div>
    </form>
  );
}

function OverridesBody({ rows }: { rows: OverrideRowSpec[] }): React.ReactElement {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-rule text-left text-[10px] tracking-wide text-muted">
            <th className="w-28 px-4 py-2 font-medium">Field</th>
            <th className="px-4 py-2 font-medium">Record</th>
            <th className="px-4 py-2 font-medium">Prints as</th>
            <th className="w-14 px-2 py-2 text-center font-medium">Hide</th>
            <th className="w-72 px-4 py-2 font-medium">Print instead</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const prints = row.hidden ? null : row.text || row.record;
            const marked = row.hidden || row.text !== "";
            return (
              <tr key={row.key} className="border-b border-rule last:border-b-0">
                <td className="px-4 py-1.5 align-top">
                  <input type="hidden" name="scope" value={row.key} />
                  <span className="block truncate text-[12px] text-muted" title={row.key}>
                    {row.label}
                  </span>
                  {row.hint && (
                    <span className="block truncate text-[12px] text-faint">{row.hint}</span>
                  )}
                </td>
                <td className="max-w-0 truncate px-4 py-1.5 align-top text-muted" title={row.record}>
                  {row.record || <span className="text-faint">—</span>}
                </td>
                <td className="max-w-0 truncate px-4 py-1.5 align-top" title={prints ?? ""}>
                  {prints === null ? (
                    <span className="text-faint">hidden</span>
                  ) : (
                    prints || <span className="text-faint">—</span>
                  )}
                  {marked && (
                    <span className="ml-2 bg-sealSoft px-1 py-px text-[10px] font-medium text-seal">
                      overridden
                    </span>
                  )}
                  {/* SAID, NOT OFFERED. A frame is four fractions of a page and
                      the only sane way to change it is to move it on the page,
                      so this reports and points rather than pretending to a
                      control it cannot honestly draw — principle 9 asks that a
                      correction be visible and reversible, and the reversal is
                      one screen away rather than absent. Without it the row was
                      silent about the one kind of override nothing else on this
                      page can see. */}
                  {row.placed && (
                    <span
                      className="ml-2 border border-seal/30 px-1 py-px text-[10px] font-medium text-seal"
                      title="Dragged to a place of its own on the page. Move it again, or reset it, in the catalogue."
                    >
                      placed by hand
                    </span>
                  )}
                </td>
                {/* THE CELL GIVES ITS PADDING UP TO THE TARGET rather than
                    stacking on top of it: `py-1.5` here and `min-h` on the
                    label would make this cell the token PLUS twelve, on a
                    table that is one row per field. Moved INSIDE the label as
                    `pt-1.5` it costs nothing — `min-height` counts padding
                    under border-box, which Tailwind sets globally — so the box
                    is exactly `--tap` and the tick still starts level with the
                    text and the input beside it. The horizontal padding goes
                    for the reason the header gives. */}
                <td className="align-top">
                  <label className="flex min-h-[var(--tap)] min-w-[var(--tap)] cursor-pointer items-start justify-center pt-1.5">
                    <input
                      type="checkbox"
                      name={`hide:${row.key}`}
                      defaultChecked={row.hidden}
                      aria-label={`Hide ${row.label} in this catalogue`}
                      className="accent-seal"
                    />
                  </label>
                </td>
                <td className="px-4 py-1.5 align-top">
                  {row.hideOnly ? (
                    <span className="text-[12px] text-faint">a photograph is not retyped</span>
                  ) : (
                    <input
                      name={`text:${row.key}`}
                      defaultValue={row.text}
                      aria-label={`Print ${row.label} as`}
                      placeholder="—"
                      className="min-h-[var(--tap)] w-full border border-rule bg-paper px-2 text-[13px]"
                    />
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
