"use client";

import type { Route } from "next";
import Link from "next/link";
import { useMemo, useState, useTransition } from "react";

import type { MoveResult } from "@/lib/forms";
import { logAction } from "@/lib/log/client";
import type { LotRow } from "@/lib/lots-view";
import { NOTHING, click, onScreen, type Selection } from "@/lib/selection";

/**
 * The sale's lots, and a run of them picked with the pointer.
 *
 * ── WHY THE TABLE IS A CLIENT COMPONENT AND THE CHROME AROUND IT IS NOT ────
 *
 * Everything that narrows this screen — the tabs, the search, the pager — is a
 * link or a GET form rendered on the server, so every view is an address and
 * works before the bundle lands. Only the SELECTION is client state, because
 * only the selection is not a property of the URL: it is a thing a hand is
 * holding for the next few seconds. The same division as the photograph
 * library, and the reason both screens can be linked to and neither needs
 * JavaScript to be read.
 *
 * ── THE SELECTION CANNOT OUTLIVE THE ROWS IT WAS MADE OVER ─────────────────
 *
 * The page keys this component on the whole query, so turning a page or
 * changing a filter remounts it empty. That is the bracing; `onScreen` is the
 * belt, intersecting the picked ids with the rows actually drawn before
 * anything is sent — so the count on the button and the rows that change are
 * the same rows. The library states the same rule, and it is the one bug a
 * bulk action can have that nobody notices until it writes to the wrong lots.
 */
export function LotsTable({
  eventId,
  rows,
  places,
  move,
}: {
  eventId: string;
  rows: readonly LotRow[];
  /** Places this house already uses, commonest first, for the datalist. */
  places: readonly string[];
  /** `moveLotsAction` with the sale bound; the ids are this component's. */
  move: (lotIds: readonly string[], formData: FormData) => Promise<MoveResult>;
}): React.ReactElement {
  const [selection, setSelection] = useState<Selection>(NOTHING);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const ids = useMemo(() => rows.map((r) => r.id), [rows]);
  const picked = onScreen(selection, ids);

  const onSend = (formData: FormData): void => {
    logAction("lots.move", { eventId, lots: picked.length });
    startTransition(async () => {
      const result = await move(picked, formData);
      setMessage(result.message);
      if (result.ok) setSelection(NOTHING);
    });
  };

  return (
    <>
      <div
        // Room for the bar, so the last row of a long sale is never under it.
        className={`mt-4 border border-rule bg-paper ${picked.length > 0 ? "mb-20" : ""}`}
      >
        {/* `table-fixed`, WITHOUT WHICH `max-w-0` DOES THE OPPOSITE OF WHAT IT
            SAYS — the column contributes zero under the automatic layout, so
            the browser gives it its minimum and hands the slack to the fixed
            ones. The inspection loop caught the result at 768px: every title
            one glyph and an ellipsis beside three columns of em-dashes at full
            width. The two registers carry the same pair for the same reason. */}
        <table className="w-full table-fixed border-collapse text-[13px]">
          <thead>
            {/* COLUMNS LEAVE BEFORE THE TITLE IS SQUEEZED. Maker and the
                photograph count go below 1280 — the threshold measured by
                re-running the inspection at every width, not picked because it
                sounded right. */}
            <tr className="border-b border-rule text-left text-[10px] tracking-wide text-muted">
              <th className="w-10 px-2 py-2 font-medium">
                <span className="sr-only">Picked</span>
              </th>
              <th className="w-24 px-3 py-2 font-medium">Ref</th>
              <th className="px-3 py-2 font-medium">Title</th>
              <th className="w-44 px-3 py-2 font-medium max-xl:hidden">Maker</th>
              <th className="w-52 px-3 py-2 font-medium max-xl:w-40">Estimate</th>
              {/* The engine's own answer, not this screen's arithmetic. */}
              <th className="w-16 px-3 py-2 text-right font-medium">Page</th>
              <th className="w-20 px-3 py-2 text-right font-medium max-xl:hidden">
                Photos
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((lot, index) => {
              const href = `/events/${eventId}/lots/${lot.id}` as Route;
              const isPicked = selection.ids.has(lot.id);
              return (
                <tr
                  key={lot.id}
                  data-lot={lot.id}
                  aria-selected={isPicked}
                  className={`border-b border-rule last:border-b-0 ${
                    isPicked ? "bg-sunk" : "hover:bg-sunk"
                  }`}
                >
                  <td className="px-2 py-2">
                    {/* THE WHOLE CELL IS THE TARGET, not the twelve-pixel box
                        inside it: `--tap` is the house floor and a checkbox is
                        the smallest thing on any screen. Shift extends the run
                        (src/lib/selection.ts), which is what makes picking
                        forty lots for a crate one gesture. */}
                    <label className="flex min-h-[var(--tap)] cursor-pointer items-center justify-center">
                      <span className="sr-only">
                        Pick {lot.ref ?? (lot.title || "this lot")}
                      </span>
                      <input
                        type="checkbox"
                        checked={isPicked}
                        className="accent-seal"
                        onChange={() => undefined}
                        onClick={(e) =>
                          setSelection((current) =>
                            click(current, ids, index, e.shiftKey),
                          )
                        }
                      />
                    </label>
                  </td>
                  <td className="px-3 py-2 font-medium" data-numeric>
                    <Link
                      href={href}
                      className="inline-flex min-h-[var(--tap)] items-center hover:text-seal hover:underline"
                    >
                      {lot.ref ?? <span className="text-faint">—</span>}
                    </Link>
                  </td>
                  <td className="max-w-0 truncate px-3 py-2">
                    <Link
                      href={href}
                      className="inline-flex min-h-[var(--tap)] max-w-full items-center truncate hover:text-seal hover:underline"
                    >
                      {lot.title || <span className="text-faint">untitled</span>}
                    </Link>
                    {/* Absent until there is something to report, rather than
                        a column of zeroes. */}
                    {lot.overrides > 0 && (
                      <span className="ml-2 text-[10px] text-seal" data-numeric>
                        {lot.overrides} overridden
                      </span>
                    )}
                  </td>
                  <td className="max-w-0 truncate px-3 py-2 text-muted max-xl:hidden">
                    {lot.maker || "—"}
                  </td>
                  <td className="max-w-0 truncate px-3 py-2 text-muted">
                    {lot.estimate || "—"}
                  </td>
                  {/* `data-page` so a driven test can name this cell rather
                      than count columns — the count changed the day the
                      checkbox arrived, and a spec that counts is a spec that
                      breaks on a layout decision. */}
                  <td
                    className="px-3 py-2 text-right text-muted"
                    data-numeric
                    data-page={lot.page ?? ""}
                  >
                    {lot.page ?? <span className="text-faint">—</span>}
                  </td>
                  {/* A lot with no plate is what this screen is for, so zero is
                      not drawn as a zero — seal is the house's word for "a
                      person is needed". */}
                  <td className="px-3 py-2 text-right max-xl:hidden" data-numeric>
                    {lot.photographs === 0 ? (
                      <span className="text-seal">none</span>
                    ) : (
                      lot.photographs
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {picked.length > 0 && (
        /* ── THE BAR, AND IT ONLY EVER SAYS ONE THING ────────────────────
           Where they went. Not who signed for them, not why, not a note —
           those belong to the lot's own movement form, where a registrar is
           recording one handoff carefully. This is the packing gesture: a run
           of lots, a destination, done. A form that asked for five fields
           before moving twelve lots would be slower than moving them one at a
           time, which is the thing it exists to replace.

           FIXED TO THE FOOT OF THE WINDOW, so a selection made at the top of a
           fifty-row page has its action in reach without scrolling back. */
        <form
          action={onSend}
          className="fixed inset-x-0 bottom-0 z-10 flex flex-wrap items-center gap-3 border-t border-ruleStrong bg-paper px-6 py-3 shadow-[0_-2px_12px_rgba(0,0,0,.06)]"
        >
          <span className="text-[13px] font-medium" data-numeric>
            {picked.length} selected
          </span>
          <button
            type="button"
            onClick={() => {
              setSelection(NOTHING);
              setMessage(null);
            }}
            className="min-h-[var(--tap)] text-[12px] text-muted underline hover:text-ink"
          >
            Clear
          </button>

          <label className="flex items-center gap-2">
            <span className="text-[12px] text-muted">Move to</span>
            <input
              name="toPlace"
              list="lots-places"
              required
              maxLength={120}
              placeholder="a room, a crate, a courier"
              className="min-h-[var(--tap)] w-56 border border-rule bg-field px-2.5 text-[13px] placeholder:text-faint"
            />
          </label>
          {/* The house's own places, so a crate keeps one spelling. A datalist
              and not a select: the next place is frequently one nobody has
              used yet, and a closed list would make the common case the hard
              one. */}
          <datalist id="lots-places">
            {places.map((place) => (
              <option key={place} value={place} />
            ))}
          </datalist>

          <button
            type="submit"
            disabled={pending}
            className="min-h-[var(--tap)] bg-seal px-4 text-[13px] font-medium text-white hover:bg-sealPress disabled:opacity-60"
          >
            {pending ? "Moving…" : `Move ${picked.length}`}
          </button>

          {message && (
            <p className="text-[12px] text-muted" role="status">
              {message}
            </p>
          )}
        </form>
      )}

      {/* The answer to a move that cleared the selection, which has nowhere
          else to be said once the bar has gone. */}
      {picked.length === 0 && message && (
        <p className="mt-3 text-[13px] text-muted" role="status">
          {message}
        </p>
      )}
    </>
  );
}
