import type { Route } from "next";
import Link from "next/link";

import { PARAM, lotsHref, type LotsView } from "@/lib/lots-view";

/*
 * `as Route`, for the reason src/components/switcher.tsx records: `typedRoutes`
 * cannot check a path built from an id at runtime — it is a plain string to the
 * compiler whatever is annotated. The PATTERNS behind these are checked against
 * src/app on disk by test/nav.test.ts, which reads the filesystem and is the
 * stronger guard.
 */
const route = (href: string): Route => href as Route;

/**
 * The sale's lots: search it, narrow it, page it, open one.
 *
 * ── A SERVER COMPONENT, AND THE CONTROLS ARE LINKS AND A GET FORM ───────────
 *
 * The same arrangement as the ledger and the photograph library, for the same
 * three reasons: it works before the bundle lands, every view is an address a
 * person can send to a colleague, and the browser's own back button does what
 * they expect. Nothing here holds state, so nothing here can disagree with the
 * URL that produced it.
 *
 * The multi-select the running order will want is a client component, and it
 * goes around the table rather than into it when it arrives — which is how the
 * library is built (src/components/photograph-library.tsx) and why the markup
 * below keeps one row per lot with a stable id on it.
 */
export function LotsIndex({
  eventId,
  view,
}: {
  eventId: string;
  view: LotsView;
}): React.ReactElement {
  return (
    <>
      {/* ── THE TABS, COUNTED OVER THE SEARCH ─────────────────────────────
          Not over the sale: "No photograph 132" while a search is showing
          four lots would be a number about a set nobody is looking at. The
          rule and the reason are in src/lib/lots-view.ts, and the count in
          each tab is the number of rows pressing it produces. */}
      <div className="mt-6 flex flex-wrap items-center gap-1 border-b border-rule">
        {view.tabs.map((tab) => (
          <Link
            key={tab.id}
            href={route(tab.href)}
            aria-current={tab.current ? "page" : undefined}
            className={`-mb-px flex min-h-[var(--tap)] items-center border-b-2 px-3 text-[13px] ${
              tab.current
                ? "border-seal font-medium text-ink"
                : "border-transparent text-muted hover:text-ink"
            }`}
          >
            {tab.label}
            <span className="ml-1.5 text-[10px] text-faint" data-numeric>
              {tab.count}
            </span>
          </Link>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        {/* The filter rides along as a hidden field so a search inside the
            unphotographed stays there, and only when it is not the default so
            that a plain search gives a plain URL. The page deliberately does
            not ride along: a new search starts at the beginning. */}
        <form method="get" action={`/events/${eventId}`} className="flex items-center gap-2">
          <label className="flex items-center gap-2">
            <span className="sr-only">Search this sale by reference or title</span>
            <input
              type="search"
              name={PARAM.q}
              defaultValue={view.query.q}
              placeholder="Find a lot by reference or title"
              className="min-h-[var(--tap)] w-64 max-w-[50vw] border border-rule bg-paper px-2.5 text-[13px] placeholder:text-faint"
            />
          </label>
          {view.query.filter !== "all" && (
            <input type="hidden" name={PARAM.filter} value={view.query.filter} />
          )}
          <button
            type="submit"
            className="min-h-[var(--tap)] border border-ruleStrong bg-paper px-3 text-[12px] font-medium hover:bg-sunk"
          >
            Search
          </button>
          {view.query.q !== "" && (
            <Link
              href={route(lotsHref(eventId, view.query, { q: "", page: 1 }))}
              className="inline-flex min-h-[var(--tap)] items-center text-[12px] text-muted underline hover:text-ink"
            >
              Clear
            </Link>
          )}
        </form>

        {/* IN THE SALE'S ORDER, and it says so. The library says "newest
            first" because its pile is chronological; a sale has one order and
            it is editorial — lot 1 is the opener — so that is the order every
            view here keeps, whatever is filtered out of it. */}
        <p className="text-[12px] text-muted" data-numeric role="status">
          {view.matched === 0
            ? "No lot matches"
            : `Showing ${view.from}–${view.to} of ${view.matched}, in the sale's order`}
        </p>
      </div>

      {view.matched === 0 ? (
        <p className="mt-6 border border-rule bg-paper px-4 py-10 text-center text-[13px] text-muted">
          Nothing in this sale answers to that.
        </p>
      ) : (
        <div className="mt-4 border border-rule bg-paper">
          {/* `table-fixed`, WITHOUT WHICH `max-w-0` DOES THE OPPOSITE OF WHAT
              IT SAYS. The cells below carry `max-w-0 truncate`, which is the
              standard way to make a table cell ellipsise — and under the
              AUTOMATIC layout it means exactly what it says: the column
              contributes zero, so the browser gives it its minimum and hands
              the slack to the fixed ones. The inspection loop caught the
              result at 768px: every title one glyph and an ellipsis while
              three columns of em-dashes kept their full width. The condition
              and movement registers carry the same pair for the same reason. */}
          <table className="w-full table-fixed border-collapse text-[13px]">
            <thead>
              {/* ── COLUMNS LEAVE BEFORE THE TITLE IS SQUEEZED ─────────────
                  The fixed widths come to more than a 768px tablet has once
                  the rail has taken its 224, and a table that shreds the
                  column identifying the row is worse than one that drops its
                  least valuable. Maker and the photograph count go below 1280
                  — the threshold measured by re-running the inspection at
                  every width, not picked because it sounded right. */}
              <tr className="border-b border-rule text-left text-[10px] tracking-wide text-muted">
                <th className="w-28 px-4 py-2 font-medium">Ref</th>
                <th className="px-4 py-2 font-medium">Title</th>
                <th className="w-44 px-4 py-2 font-medium max-xl:hidden">Maker</th>
                <th className="w-52 px-4 py-2 font-medium max-xl:w-40">Estimate</th>
                {/* THE ENGINE'S OWN ANSWER, not this screen's arithmetic. The
                    editor's lots panel prints the same number from the same
                    derivation. */}
                <th className="w-16 px-4 py-2 text-right font-medium">Page</th>
                <th className="w-20 px-4 py-2 text-right font-medium max-xl:hidden">
                  Photos
                </th>
              </tr>
            </thead>
            <tbody>
              {view.rows.map((lot) => {
                const href = route(`/events/${eventId}/lots/${lot.id}`);
                return (
                  <tr
                    key={lot.id}
                    data-lot={lot.id}
                    className="border-b border-rule last:border-b-0 hover:bg-sunk"
                  >
                    <td className="px-4 py-2 font-medium" data-numeric>
                      {/* ON THE HOUSE FLOOR, like every other pressable
                          thing: `--tap` is 28px with a mouse and 44 under a
                          coarse pointer, and a row of a 300-lot sale opened on
                          a tablet at a viewing is exactly the case the token
                          was argued for. `inline-flex items-center`, because a
                          bare `min-h` does nothing to an inline box. */}
                      <Link
                        href={href}
                        className="inline-flex min-h-[var(--tap)] items-center hover:text-seal hover:underline"
                      >
                        {lot.ref ?? <span className="text-faint">—</span>}
                      </Link>
                    </td>
                    <td className="max-w-0 truncate px-4 py-2">
                      <Link
                        href={href}
                        className="inline-flex min-h-[var(--tap)] max-w-full items-center truncate hover:text-seal hover:underline"
                      >
                        {lot.title || <span className="text-faint">untitled</span>}
                      </Link>
                      {/* WHAT THIS CATALOGUE SAYS, beside the name it says it
                          about. A count in a column of its own would be a
                          sixth column for a number that is zero on almost
                          every row; here it is absent until there is something
                          to report, which is the same rule the lot's own
                          header follows. */}
                      {lot.overrides > 0 && (
                        <span className="ml-2 text-[10px] text-seal" data-numeric>
                          {lot.overrides} overridden
                        </span>
                      )}
                    </td>
                    <td className="max-w-0 truncate px-4 py-2 text-muted max-xl:hidden">
                      {lot.maker || "—"}
                    </td>
                    <td className="max-w-0 truncate px-4 py-2 text-muted">
                      {lot.estimate || "—"}
                    </td>
                    <td className="px-4 py-2 text-right text-muted" data-numeric>
                      {lot.page ?? <span className="text-faint">—</span>}
                    </td>
                    {/* A LOT WITH NO PLATE IS THE ONE THING THIS SCREEN IS
                        FOR, so zero is not drawn as a zero — it is the seal,
                        which is this product's word for "a person is needed". */}
                    <td className="px-4 py-2 text-right max-xl:hidden" data-numeric>
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
      )}

      <Pager view={view} />
    </>
  );
}

/**
 * Forward and back through the pages of a long sale.
 *
 * Absent below two pages, so a sale of forty lots has no chrome it does not
 * need — the library's own rule, and the reason a control with nowhere to go
 * is not rendered rather than rendered disabled.
 */
function Pager({ view }: { view: LotsView }): React.ReactElement | null {
  if (view.pages < 2) return null;
  const box =
    "flex min-h-[var(--tap)] items-center border border-ruleStrong bg-paper px-3 text-[12px] font-medium";
  return (
    <nav
      aria-label="Pages of this sale"
      className="mt-4 flex items-center justify-between gap-3"
    >
      {view.previous ? (
        <Link href={route(view.previous)} className={`${box} hover:bg-sunk`}>
          ‹ Previous
        </Link>
      ) : (
        <span className={`${box} opacity-40`}>‹ Previous</span>
      )}
      <span className="text-[12px] text-muted" data-numeric>
        Page {view.page} of {view.pages}
      </span>
      {view.next ? (
        <Link href={route(view.next)} className={`${box} hover:bg-sunk`}>
          Next ›
        </Link>
      ) : (
        <span className={`${box} opacity-40`}>Next ›</span>
      )}
    </nav>
  );
}
