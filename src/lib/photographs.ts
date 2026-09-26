// The photograph library, as a function of a URL.
//
// ── WHAT THIS IS FOR, MEASURED ──────────────────────────────────────────────
//
// As built, the library rendered EVERY tile of the org into the document, with
// the data layer's own `limit: 500` as the only bound. Measured against a
// production build (`next build`, then the standalone server the image runs)
// on a database holding 424 photographs: the served HTML of `/photographs` was
// 1,475,396 bytes, and one tile cost 775 bytes of it — taken as the median
// distance between two consecutive `/api/assets/` markers in the response, the
// way src/lib/nav.ts measured the switcher's rows. 424 of them is 329,963
// bytes spanned, and at the 500-row cap it would be about 387,500.
//
// Re-measure it the same way: build, serve, fetch the page, divide.
//
// ── THE SHAPE IS THE LEDGER'S, DELIBERATELY ─────────────────────────────────
//
// src/lib/ledger.ts solved this once and this follows it rather than inventing
// a second answer: the query lives in the URL, the search is a plain
// `<form method="get">` so it works before the bundle lands, every control is
// a link somebody can send, and the count says what is shown of what exists.
// A specialist who has found the eleven unfiled photographs of one shoot can
// paste that address to the person who took them.
//
// ── WHERE IT DIFFERS FROM THE LEDGER, AND WHY ───────────────────────────────
//
// The ledger filters and pages IN JAVASCRIPT, over rows it has already
// fetched, and its own header explains that this is forced: a sale's stage is
// DERIVED from four counts by a workflow rule a house can replace, so filtering
// by stage in SQL would mean writing that rule a second time in a dialect that
// cannot read it.
//
// Nothing here is derived. "On a lot" is `exists (select 1 from lot_assets …)`
// and the search is a substring of a column, which are two things SQL already
// does exactly once. And the ceiling is different in kind: the ledger's cost is
// a function of how many SALES a house has — a few hundred — while this one is
// a function of how many PHOTOGRAPHS it has ever taken, which for a house that
// shoots a thousand lots a year is the number that grows without bound. So the
// filter, the search, the count and the page are all in the query, and this
// module is the arithmetic around them.
//
// ── THE SEARCH IS OVER THE FILENAME, BECAUSE IT IS ALL THERE IS ─────────────
//
// An asset has no title and no caption; it has the name the camera or the
// photographer gave the file, and that name is what the shoot list the house
// works from says. Substring rather than prefix — "4471" finds `IMG_4471.CR2`
// — and case-insensitive, for the same reason the ledger's is: nobody types a
// filename's capitals.

import type { AssetFilter } from "@/lib/data/assets";

/**
 * Tiles to a page.
 *
 * TWO MEASUREMENTS AGREE ON ABOUT FIFTY AND THE LARGER ONE WINS.
 *
 * The first is the gesture. This screen exists so that a run of photographs
 * can be selected and filed in one action, and the component states the common
 * case as forty consecutive photographs assigned to one lot
 * (src/components/photograph-library.tsx). A page smaller than the run breaks
 * the gesture in half, so the page has to be at least forty.
 *
 * The second is the window. The grid is `repeat(auto-fill, minmax(148px, 1fr))`
 * with a 12px gap, and a tile is a 128px plate over a two-line caption, so a
 * row is about 180px tall. At the 1440px window the driven suite uses, the
 * content column is about 1,100px and takes seven tiles; 48 is seven rows,
 * which is a little over one screen of a 900px window and well inside the
 * ledger's own rule that scrolling is cheaper than pressing Next until about
 * two.
 *
 * Re-measure it the way it was measured: read the grid's classes for the
 * columns, a tile's rendered height for the rows. If the tile grows, this
 * shrinks — but not below the run somebody selects in one gesture.
 */
export const PAGE_SIZE = 48;

/** What a `<form method="get">` and a `<Link>` call each of these. */
export const PARAM = { q: "q", filter: "filter", page: "page" } as const;

export interface LibraryQuery {
  /** What was typed in the search box, trimmed. "" for none. */
  q: string;
  filter: AssetFilter;
  /** 1-based, before clamping. */
  page: number;
}

/** The default view: everything the house holds, newest first, page one. */
export const DEFAULT_QUERY: LibraryQuery = { q: "", filter: "all", page: 1 };

type RawParams = Record<string, string | string[] | undefined>;

/** The first value of a parameter, for a URL that repeated it. */
function one(raw: RawParams, key: string): string {
  const value = raw[key];
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

/**
 * Make sense of whatever the URL holds.
 *
 * TOTAL, the way `readQuery` in src/lib/ledger.ts is: this is a query string,
 * so anybody can put anything in it — a filter that never existed, a page of
 * `-3` or of `banana`, the same key twice — and none of that is an error a
 * person should be shown. It is also what the filter links already relied on,
 * since the page has always fallen back to "all" for an unknown one.
 */
export function readQuery(raw: RawParams): LibraryQuery {
  const filter = one(raw, PARAM.filter);
  const page = Number.parseInt(one(raw, PARAM.page), 10);
  return {
    q: one(raw, PARAM.q).trim(),
    filter: filter === "unassigned" || filter === "assigned" ? filter : "all",
    page: Number.isFinite(page) && page > 0 ? page : 1,
  };
}

/**
 * The library at a different query — a filter, a page, a search.
 *
 * The default is never written down, so `/photographs` stays `/photographs`
 * until somebody has actually narrowed something and two URLs cannot mean the
 * same view. The same rule, and the same sentence, as `ledgerHref`.
 */
export function libraryHref(
  query: LibraryQuery,
  patch: Partial<LibraryQuery> = {},
): "/photographs" | `/photographs?${string}` {
  const next = { ...query, ...patch };
  const search = new URLSearchParams();
  if (next.q) search.set(PARAM.q, next.q);
  if (next.filter !== DEFAULT_QUERY.filter) search.set(PARAM.filter, next.filter);
  if (next.page > 1) search.set(PARAM.page, String(next.page));
  const qs = search.toString();
  return qs ? `/photographs?${qs}` : "/photographs";
}

export interface LibraryTab {
  id: AssetFilter;
  label: string;
  /** How many photographs this filter holds OF WHAT THE SEARCH LEFT. */
  count: number;
  current: boolean;
  href: "/photographs" | `/photographs?${string}`;
}

/** The three counts one query over the search returns. */
export interface LibraryCounts {
  all: number;
  unassigned: number;
  assigned: number;
}

export interface LibraryView {
  query: LibraryQuery;
  tabs: LibraryTab[];
  /** What the search and the filter leave. */
  matched: number;
  /** 1-based and CLAMPED — the page that is actually shown. */
  page: number;
  pages: number;
  /** 1-based inclusive positions of the first and last tile on this page. */
  from: number;
  to: number;
  /** How many rows to ask the database for, and from where. */
  limit: number;
  offset: number;
  /** Null at the ends, so a control with nowhere to go is not rendered. */
  previous: "/photographs" | `/photographs?${string}` | null;
  next: "/photographs" | `/photographs?${string}` | null;
}

const LABEL: Record<AssetFilter, string> = {
  all: "All",
  unassigned: "Unassigned",
  assigned: "On a lot",
};

/**
 * The view the URL asks for.
 *
 * PURE: counts in, a view out, no database and no request — so the paging
 * arithmetic, the tab counts and the clamping are a table of cases in
 * test/photographs.test.ts rather than something only a browser can find out.
 *
 * IT RETURNS THE OFFSET RATHER THAN TAKING THE ROWS, which is the one shape
 * difference from `readLedger` and it follows from where the paging happens.
 * The ledger already has every row in hand and cuts a page out of it; here the
 * cut is the database's, so this has to be called BEFORE the listing query and
 * hand it the numbers. That also means the clamp is honoured — a stale link to
 * page nine of a view that has since shrunk to four asks the database for page
 * four rather than for an empty window past the end.
 */
export function readLibrary(counts: LibraryCounts, query: LibraryQuery): LibraryView {
  const tabs: LibraryTab[] = (["all", "unassigned", "assigned"] as const).map((id) => ({
    id,
    label: LABEL[id],
    count: counts[id],
    current: id === query.filter,
    // Changing the filter returns to page one: page three of the unassigned
    // is not page three of anything else, and landing on an empty page
    // because the previous view was longer is the classic paging bug.
    href: libraryHref(query, { filter: id, page: 1 }),
  }));

  const matched = counts[query.filter];
  const pages = Math.max(1, Math.ceil(matched / PAGE_SIZE));
  const page = Math.min(query.page, pages);
  const offset = (page - 1) * PAGE_SIZE;
  const shown = Math.max(0, Math.min(PAGE_SIZE, matched - offset));

  return {
    query,
    tabs,
    matched,
    page,
    pages,
    from: shown === 0 ? 0 : offset + 1,
    to: offset + shown,
    limit: PAGE_SIZE,
    offset,
    previous: page > 1 ? libraryHref(query, { page: page - 1 }) : null,
    next: page < pages ? libraryHref(query, { page: page + 1 }) : null,
  };
}
