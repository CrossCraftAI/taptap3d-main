import Link from "next/link";

import { createEventAction } from "@/app/actions";
import { NextAction, StageCell } from "@/components/stage";
import {
  ALL,
  DEFAULT_QUERY,
  OPEN,
  PARAM,
  ledgerHref,
  type LedgerView,
} from "@/lib/ledger";

/**
 * One ledger, across every sale.
 *
 * ── THE ROW IS THE SCREEN ───────────────────────────────────────────────────
 *
 * Four columns: which sale, how big it is, where it has got to, and the one
 * thing to do next. The last two are DERIVED — nobody files a status here, so
 * nobody can forget to — and they come from the same `readStage` the event page
 * reads, so the two cannot disagree about one sale.
 *
 * This replaced three screens. `/catalogues` and `/exports` were this table
 * with a different verb bolted to the last column; the verb is the stage's now,
 * per sale, which is the question a global "Exports" could never answer.
 * src/lib/ledger.ts holds that argument in full.
 *
 * ── THE WHOLE ROW IS A DOOR ─────────────────────────────────────────────────
 *
 * A list of things you can open, where the only way in is a button in the last
 * column, reads as a report. So the sale's name is a real link and its `::after`
 * is stretched over the row, and the call to action is positioned after it in
 * document order so it stays pressable through the overlay.
 *
 * Rejected: a click handler on the row. It needs JavaScript for a navigation,
 * it gives the keyboard nothing, and it cannot be middle-clicked into a new tab
 * — which is how a specialist opens three sales to compare them. The stretched
 * link is one real `<a>`: one accessible name, one tab stop, one hit area.
 *
 * WHAT THIS DEPENDS ON, so the next person knows what to check: `relative` on
 * a `<tr>` making it the containing block for an absolutely positioned
 * descendant. CSS 2.1 left that undefined and engines disagreed for years;
 * every current one implements it. If it ever regresses the failure is not
 * subtle — the overlay resolves against the page instead and the whole window
 * becomes a link to the first sale — so it is worth a glance in any browser
 * pass rather than a unit test, which cannot see it.
 *
 * ── WHY IT IS A TABLE AND NOT A LIST OF CARDS ───────────────────────────────
 *
 * The lot counts have to line up down the column or they are not a count, and
 * the question this screen answers is comparative — sixty sales, which needs me
 * today. A card grid answers "tell me about this one".
 */

function formatDate(value: Date | null): string {
  return value
    ? new Intl.DateTimeFormat("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        // The catalogue is produced in Hong Kong, so a date is read there. A
        // server in another zone must not shift a sale by a day.
        timeZone: "Asia/Hong_Kong",
      }).format(value)
    : "No date yet";
}

export function Ledger({ view }: { view: LedgerView }): React.ReactElement {
  const { query, rows } = view;

  return (
    <>
      {/* ── THE STAGE TABS ───────────────────────────────────────────────────
          The filters are the facts a specialist has about a sale, not the
          table's columns: they ask "which ones are still being photographed",
          never "which ones have a non-null stage_override". The names and the
          count of them are the WORKFLOW'S — a house that authors its own gets
          its own tabs here with no change to this file.

          Open leads because that is the workspace; the archive is one press
          away and never the default. */}
      <div
        className="mt-4 flex flex-wrap gap-px border-b border-rule"
        role="group"
        aria-label="Filter by where a sale has got to"
      >
        {view.tabs.map((tab) => (
          <Link
            key={tab.id}
            href={tab.href}
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
        {/* A PLAIN GET FORM, so the search works before the bundle lands and
            the result is an address somebody can send. The tab rides along as
            a hidden field — searching inside "Photographed" stays there — but
            only when it is not the default, so a plain search gives a plain
            URL. The page deliberately does not ride along: a new search starts
            at the beginning. */}
        <form method="get" action="/" className="flex items-center gap-2">
          <label className="flex items-center gap-2">
            <span className="sr-only">Search sales by name</span>
            <input
              type="search"
              name={PARAM.q}
              defaultValue={query.q}
              placeholder="Find a sale by name"
              className="min-h-[var(--tap)] w-64 max-w-[50vw] border border-rule bg-paper px-2.5 text-[13px] placeholder:text-faint"
            />
          </label>
          {query.tab !== DEFAULT_QUERY.tab && (
            <input type="hidden" name={PARAM.tab} value={query.tab} />
          )}
          <button
            type="submit"
            className="min-h-[var(--tap)] border border-ruleStrong bg-paper px-3 text-[12px] font-medium hover:bg-sunk"
          >
            Search
          </button>
          {query.q !== "" && (
            <Link
              href={ledgerHref(query, { q: "", page: 1 })}
              className="text-[12px] text-muted underline hover:text-ink"
            >
              Clear
            </Link>
          )}
        </form>

        <p className="text-[12px] text-muted" data-numeric role="status">
          {view.matched === 0
            ? "Nothing here"
            : `Showing ${view.from}–${view.to} of ${view.matched}, newest first`}
        </p>
      </div>

      {/* OUT OF THE TABLE. A <caption> inherits the table's width and is cut
          off by the horizontal scroll on a narrow window, which reads as broken
          rather than as scrollable; described-by keeps the association for a
          screen reader.

          IT SAYS WHAT IS DERIVED, NOT "nothing is typed in" — because two
          things on this screen are. A sale's name is typed into the line below,
          and a person may overrule the stage, in which case the row says so.
          A sentence that is nearly true is worse here than a longer one. */}
      {/* MEASURED AT 185 CHARACTERS A LINE on a wide window, which is two and a
          half times the width at which an eye reliably finds the start of the
          next one. A sentence nobody finishes is not a shorter sentence, it is
          no sentence — so the line length is capped rather than the words cut,
          because the length is what was wrong. */}
      <p id="ledger-note" className="mt-4 max-w-prose text-[12px] leading-relaxed text-faint">
        Where a sale has got to is read from its lots, photographs, catalogues
        and exports. Nobody files a status, so nobody can forget to — and where
        a person has overruled the reading, the row says so.
      </p>

      <div className="mt-2 border border-rule bg-paper">
        {/* ── QUICK-ADD IS THE NEXT BLANK LINE OF THE LEDGER, not a modal ────
            An auction house's own working record is a numbered book you write
            the next line into; a dialog that covers the list you are reading is
            a worse version of that. It also means the shortcut from "I have a
            new sale" to "I am importing its lots" is one keystroke and one
            click, which is the demo's opening move.

            It sits ABOVE the table rather than as its first `<tr>`, which is
            where it used to be. With tabs and pages a create row inside the
            body would appear on page seven of the exported sales — a blank
            line in the middle of an archive. Above the table it is still the
            first line of the ledger and it is on every view. */}
        <form
          action={createEventAction}
          className="flex flex-wrap items-center gap-2 border-b border-rule bg-field/60 px-4 py-2"
        >
          <input
            name="name"
            required
            placeholder="Name a new event"
            aria-label="Event name"
            className="min-h-[var(--tap)] min-w-0 flex-1 border border-rule bg-paper px-2.5 text-[13px] placeholder:text-faint"
          />
          <input
            name="heldOn"
            type="date"
            aria-label="Date held, if known"
            className="min-h-[var(--tap)] border border-rule bg-paper px-2.5 text-[13px] text-muted"
          />
          <button
            type="submit"
            className="min-h-[var(--tap)] bg-seal px-3 text-[13px] font-medium text-white hover:bg-sealPress"
          >
            Create event
          </button>
        </form>

        {/* The table scrolls sideways below its own width rather than
            squashing four columns into a phone; the create line above does
            not, because a field you cannot see is a field you cannot fill. */}
        <div className="overflow-x-auto">
          <table
            className="w-full min-w-[40rem] border-collapse text-[13px]"
            aria-describedby="ledger-note"
          >
            <thead>
              <tr className="border-b border-rule text-left text-[10px] tracking-wide text-muted">
                <th className="px-4 py-2 font-medium">Sale</th>
                <th className="w-24 px-4 py-2 text-right font-medium">Lots</th>
                <th className="w-60 px-4 py-2 font-medium">Where it has got to</th>
                <th className="w-44 px-4 py-2 text-right font-medium">Next</th>
              </tr>
            </thead>

            <tbody>
              {rows.map(({ event, reading, midJob }) => (
                <tr
                  key={event.id}
                  className="relative border-b border-rule last:border-b-0 hover:bg-sunk"
                >
                  <td className="max-w-0 px-4 py-2.5 align-top">
                    {/* THE WHOLE NAME IS ON THE LINK. A real sale is named
                        「香港蘇富比二零二六年春季中國古代書畫及近現代名家精品
                        專場拍賣會第一部分」 and at 768px this cell shows about
                        seven characters of it — measured, 96px of the 455px the
                        name wants. The switcher's own truncation was designed
                        with a `title`; this one was not, so the rest of the name
                        was unreachable rather than merely hidden. */}
                    <Link
                      href={`/events/${event.id}`}
                      title={event.name}
                      className="block truncate font-medium after:absolute after:inset-0 after:content-['']"
                    >
                      {event.name}
                    </Link>
                    <span className="mt-0.5 block truncate text-[12px] text-muted">
                      {formatDate(event.heldOn)}
                    </span>
                  </td>

                  <td className="px-4 py-2.5 text-right align-top" data-numeric>
                    {event.lotCount === 0 ? (
                      <span className="text-faint">—</span>
                    ) : (
                      <>
                        <span className="block">{event.lotCount}</span>
                        {/* The lot count is what the column promises; the plate
                            tally under it is the one number that says whether the
                            current step is half done, and the stage label above
                            cannot — "Recorded" reads the same at 1 of 200 and at
                            199 of 200. */}
                        <span
                          title={`${event.photographedCount} of ${event.lotCount} photographed`}
                          className={`mt-0.5 block text-[12px] ${
                            event.photographedCount === event.lotCount
                              ? "text-muted"
                              : "text-faint"
                          }`}
                        >
                          {event.photographedCount} / {event.lotCount}
                        </span>
                      </>
                    )}
                  </td>

                  <td className="px-4 py-2.5 align-top">
                    <StageCell reading={reading} />
                  </td>

                  <td className="px-4 py-2 text-right align-top">
                    {/* LOUD ONLY WHERE SOMEBODY IS PART-WAY THROUGH. Every sale
                        short of the end has work outstanding, so painting them
                        all as the accent would paint most of the list and the
                        accent would stop meaning anything. `isMidJob` says which
                        ones somebody actually stopped in the middle of. */}
                    <span className="relative z-10 inline-flex">
                      <NextAction
                        reading={reading}
                        eventId={event.id}
                        primary={midJob}
                      />
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {rows.length === 0 && <Nothing view={view} />}
      </div>

      <Pager view={view} />
    </>
  );
}

/**
 * The three ways this table is empty, told apart.
 *
 * The mockup never drew one (§7 of the artefact manifest: "states the mockup
 * never shows, which the product must"), and one sentence for all three is the
 * usual outcome — "No results", under a filter the person has forgotten they
 * set. Each of these names what is in the way and offers the press that removes
 * it.
 */
function Nothing({ view }: { view: LedgerView }): React.ReactElement {
  const { query, total, tabs } = view;

  // NOTHING AT ALL is a different sentence from nothing HERE: one is a house
  // that has not started, the other is a filter. The first offers the line
  // above; the second offers to take the filter off.
  if (total === 0) {
    return (
      <p className="px-4 py-10 text-center text-[13px] leading-relaxed text-muted">
        Name the sale you are cataloguing on the line above, and the lots go in
        next.
      </p>
    );
  }

  const tab = tabs.find((t) => t.current);
  // Named so the sentence reads: "No sale …" — "still in production", "at
  // Photographed", or nothing at all when the tab is everything.
  const where =
    !tab || tab.id === ALL
      ? ""
      : tab.id === OPEN
        ? " still in production"
        : ` at ${tab.label}`;

  return (
    <div className="px-4 py-10 text-center text-[13px] leading-relaxed text-muted">
      <p>
        {query.q === "" ? (
          <>No sale is{where || " here"} just now.</>
        ) : (
          <>
            No sale{where} is named{" "}
            <span className="font-medium text-ink">“{query.q}”</span>.
          </>
        )}
      </p>
      <p className="mt-3">
        {query.q !== "" && (
          <>
            <Link
              href={ledgerHref(query, { q: "", page: 1 })}
              className="underline hover:text-ink"
            >
              Clear the search
            </Link>
            {where !== "" && <span className="px-2 text-rule">·</span>}
          </>
        )}
        {where !== "" && (
          <Link
            href={ledgerHref(query, { q: "", tab: ALL, page: 1 })}
            className="underline hover:text-ink"
          >
            Look at every sale
          </Link>
        )}
      </p>
    </div>
  );
}

/**
 * Forward and back through the pages.
 *
 * A LINK WHERE THERE IS SOMEWHERE TO GO, A BUTTON WHERE THERE IS NOT — the same
 * rule and the same reason as the lot stepper (src/components/lot-steps.tsx):
 * there is no such thing as a disabled link, and `aria-disabled` on an anchor
 * still takes focus and still navigates.
 *
 * No numbered pages. Ten of them is a row of digits nobody reads, and the way
 * to a sale you can name is the search box, not page six.
 */
function Pager({ view }: { view: LedgerView }): React.ReactElement | null {
  if (view.pages < 2) return null;
  const box =
    "flex min-h-[var(--tap)] items-center border border-ruleStrong bg-paper px-3 text-[12px] font-medium";
  return (
    <nav
      aria-label="Pages of the ledger"
      className="mt-3 flex items-center justify-between gap-3"
    >
      {view.previous ? (
        <Link href={view.previous} className={`${box} hover:bg-sunk`}>
          ‹ Previous
        </Link>
      ) : (
        <button type="button" disabled className={`${box} opacity-40`}>
          ‹ Previous
        </button>
      )}
      <p className="text-[12px] text-muted" data-numeric>
        Page {view.page} of {view.pages}
      </p>
      {view.next ? (
        <Link href={view.next} className={`${box} hover:bg-sunk`}>
          Next ›
        </Link>
      ) : (
        <button type="button" disabled className={`${box} opacity-40`}>
          Next ›
        </button>
      )}
    </nav>
  );
}
