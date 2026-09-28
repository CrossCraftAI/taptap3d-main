import Link from "next/link";

import { Dropzone } from "@/components/dropzone";
import { PageHeader } from "@/components/page-header";
import { PhotographLibrary } from "@/components/photograph-library";
import { countAssets, countLibrary, listAssets } from "@/lib/data/assets";
import { listLotChoices } from "@/lib/data/lots";
import { currentOrgOrNull } from "@/lib/data/org";
import {
  PARAM,
  libraryHref,
  readLibrary,
  readQuery,
  type LibraryView,
} from "@/lib/photographs";

export const dynamic = "force-dynamic";

/**
 * The library, a page at a time.
 *
 * ── WHAT THIS PAGE COSTS, AND WHICH TERM IS WHICH ───────────────────────────
 *
 * Measured against a production build on a database holding 424 photographs
 * and 6,921 lots — `next build`, then the standalone server the image runs,
 * then the served HTML of `/photographs` counted. It was 1,475,396 bytes, and
 * it had two large terms rather than one:
 *
 *   the tiles      424 of them at 775 bytes each, spanning 329,963 bytes.
 *                  That is what the page below now cuts: `PAGE_SIZE` is 48,
 *                  so a page of tiles is about 37,000 bytes whatever the house
 *                  holds. src/lib/photographs.ts carries the arithmetic.
 *
 *   the lot picker 5,000 rows at 161 bytes each, spanning 797,348 bytes — the
 *                  `listLotChoices` payload below, serialised into the flight
 *                  data of every load so the picker can filter as somebody
 *                  types. It is TWO AND A HALF TIMES the tiles and it is not
 *                  fixed here.
 *
 * ── WHY THE LARGER TERM IS LEFT, NAMED RATHER THAN HIDDEN ───────────────────
 *
 * Capping it silently is the one thing that must not be done: the picker's
 * search reads the whole set, so a capped list loses the lot somebody is typing
 * the reference of — exactly the failure src/lib/nav.ts refuses for the event
 * switcher, where the fix was to cap what is PAINTED and send everything. That
 * trick does not transfer, because here the cost IS the payload and not the
 * DOM.
 *
 * ── AND THE CAP WAS ALREADY HERE, WHICH THIS NOTE DID NOT KNOW ──────────────
 *
 * `listLotChoices` has ended in `.limit(5000)` since it was written, so the
 * paragraph above described a rule the code was already breaking. The UI
 * inspection loop found it against a database of 11,665 lots: a sale created
 * ninety seconds earlier could not be found by its own reference, and nothing
 * on the screen said why, because "no match" and "not sent" are the same
 * answer from a component that only has what it was given.
 *
 * Two things changed, and neither is the real fix. The cut is by RECENCY rather
 * than alphabetical — the lots being filed against are the ones from the sale
 * being worked on, where an alphabetical cut is a cut at a letter — and the
 * total travels with the list, so the picker says that it is not showing
 * everything and where to go instead. Loud and partial beats quiet and partial;
 * neither beats complete.
 *
 * The real fix is still the one `listLotChoices` names: it becomes a search
 * endpoint, the picker asks as the person types, and the component above it
 * does not change shape. That is a route, a debounce and a pending state, and
 * it is a different piece of work from paginating a grid.
 *
 * ── THE FILTERS WERE ALREADY LINKS, AND THEY STAY LINKS ─────────────────────
 *
 * They are facts about a photograph — is it on a lot — so they are a URL like
 * every other control on this screen. What changes is that they now carry the
 * search with them and reset the page, and that their counts are of what the
 * search left rather than of the whole store: a tab reading "12" that lands on
 * an empty grid is the defect a faceted count exists to prevent.
 */
export default async function PhotographsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.ReactElement> {
  const org = await currentOrgOrNull();
  if (!org) {
    return (
      <div className="mx-auto max-w-lg px-8 py-20">
        <h1 className="text-[16px] font-semibold">No organisation yet</h1>
        <p className="mt-2 text-[13px] leading-relaxed text-muted">
          There is no house set up on this installation yet.
        </p>
      </div>
    );
  }

  const query = readQuery(await searchParams);

  // COUNT, THEN LIST, AND THE ORDER IS FORCED. The page is clamped to what
  // exists — a stale link to page nine of a view that has since shrunk to four
  // shows page four, the same rule the ledger follows — and the clamp needs
  // the total before the offset can be chosen. Two round trips rather than
  // one; the alternative is asking for a window past the end of the table and
  // rendering an empty grid at a page number nothing can reach.
  const counts = await countLibrary(org.id, query.q);
  const view = readLibrary(counts, query);

  const [rows, held, choices] = await Promise.all([
    listAssets(org.id, {
      filter: view.query.filter,
      q: view.query.q,
      limit: view.limit,
      offset: view.offset,
    }),
    // The house's own total, which the heading states and the search must not
    // move: "1,204 held" is a fact about the house, and a number in a heading
    // that changes when somebody types is a number nobody can use.
    countAssets(org.id),
    listLotChoices(org.id),
  ]);

  return (
    <div className="px-8 py-8">
      <PageHeader
        title="Photographs"
        meta={
          held.total === 0
            ? "none yet"
            : `${held.total} held · ${held.unassigned} not on a lot`
        }
      />

      {/* THE FILTER IS THE WORKFLOW, not a refinement. "Unassigned" is the pile a
          cataloguer works through, so it is one click from the landing rather
          than behind a search. */}
      <div
        className="mt-4 flex flex-wrap gap-px border-b border-rule"
        role="group"
        aria-label="Filter by whether a photograph is on a lot"
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
            the result is an address somebody can send — the ledger's own
            arrangement (src/components/ledger.tsx) rather than a second one.
            The filter rides along as a hidden field, so searching inside the
            unassigned pile stays there, but only when it is not the default so
            that a plain search gives a plain URL. The page deliberately does
            not ride along: a new search starts at the beginning. */}
        <form method="get" action="/photographs" className="flex items-center gap-2">
          <label className="flex items-center gap-2">
            <span className="sr-only">Search photographs by filename</span>
            <input
              type="search"
              name={PARAM.q}
              defaultValue={view.query.q}
              placeholder="Find a photograph by filename"
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
              href={libraryHref(view.query, { q: "", page: 1 })}
              className="text-[12px] text-muted underline hover:text-ink"
            >
              Clear
            </Link>
          )}
        </form>

        {/* WHAT IS SHOWN OF WHAT EXISTS. It says "newest first" because the
            order is fixed here — the pile a person works through is the one
            that just arrived — unlike the ledger, which has three orders and
            names whichever is current. */}
        <p className="text-[12px] text-muted" data-numeric role="status">
          {view.matched === 0
            ? "Nothing here"
            : `Showing ${view.from}–${view.to} of ${view.matched}, newest first`}
        </p>
      </div>

      <Dropzone>
        {/* KEYED ON THE WHOLE QUERY, which is what makes "the selection is
            what is on screen" true rather than hoped for. A client-side
            navigation between two queries of one route re-renders this page
            without necessarily remounting the component below it, so eleven
            photographs picked on page one could otherwise still be selected —
            and still be what the Assign button writes — over a grid showing
            none of them. The component argues the choice at length; this line
            is the whole of its enforcement. */}
        <PhotographLibrary
          key={`${view.query.filter}|${view.query.q}|${view.page}`}
          assets={rows}
          lots={choices.choices}
          // What the picker is NOT showing. A cap that says nothing is a lot
          // that cannot be found by its own reference — see listLotChoices.
          lotsHeld={choices.total}
          view={view}
        />
      </Dropzone>

      <Pager view={view} />
    </div>
  );
}

/**
 * Forward and back through the pages.
 *
 * A LINK WHERE THERE IS SOMEWHERE TO GO, A BUTTON WHERE THERE IS NOT — the
 * same rule, the same classes and the same reason as the ledger's pager and
 * the lot stepper: there is no such thing as a disabled link, and
 * `aria-disabled` on an anchor still takes focus and still navigates.
 *
 * OUTSIDE THE DROPZONE, unlike everything above it. The grid is a drop target
 * and this is a navigation; a folder released on "Next ›" should do what a
 * folder released anywhere else on the page does, and it does, because the
 * dropzone wraps the grid rather than the screen.
 */
function Pager({ view }: { view: LibraryView }): React.ReactElement | null {
  if (view.pages < 2) return null;
  const box =
    "flex min-h-[var(--tap)] items-center border border-ruleStrong bg-paper px-3 text-[12px] font-medium";
  return (
    <nav
      aria-label="Pages of the library"
      className="mt-4 flex items-center justify-between gap-3"
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
