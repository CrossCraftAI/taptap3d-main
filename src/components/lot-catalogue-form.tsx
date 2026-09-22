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
  catalogueId: string;
  catalogueName: string;
  rows: OverrideRowSpec[];
  version: number;
}): React.ReactElement {
  const [state, action, pending] = useActionState<LotFormState, FormData>(
    setLotOverridesAction.bind(null, eventId, lotId),
    IDLE_LOT_FORM,
  );
  const overridden = rows.filter((r) => r.hidden || r.text).length;

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
          className="shrink-0 border border-ruleStrong bg-paper px-3 py-1.5 text-[13px] font-medium hover:bg-sunk disabled:opacity-60"
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
                </td>
                <td className="px-2 py-1.5 text-center align-top">
                  <input
                    type="checkbox"
                    name={`hide:${row.key}`}
                    defaultChecked={row.hidden}
                    aria-label={`Hide ${row.label} in this catalogue`}
                    className="accent-seal"
                  />
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
                      className="w-full border border-rule bg-paper px-2 py-1 text-[13px]"
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
