// The sale's index, as a function of its URL.
//
// ── WHY THIS SCREEN NEEDED ONE AT ALL ───────────────────────────────────────
//
// The lots list drew every row a sale had. At the seeded eight that is a table;
// at the house's own numbers — 100 to 300 lots a sale (DFD.md) — it is a page
// you scroll past rather than read, with no way to ask it a question. The
// inspection loop measured a 160-lot sale at ten widths and the finding was not
// that anything overflowed: it was that the screen had nothing to say about any
// particular lot, and nothing to narrow itself by.
//
// ── THE CUT IS IN JAVASCRIPT, NOT IN SQL, AND THAT IS THE DIFFERENCE FROM
//    src/lib/photographs.ts ─────────────────────────────────────────────────
//
// The library pages in the database because the rows it is paging are the only
// reason it queries at all. This screen already has every lot in hand for
// another purpose — the stage counts are over the whole sale, and so are the
// filter counts — so a second query to fetch a window of what is already loaded
// would be a round trip bought with nothing. `readLedger` makes the same call
// for the same reason, and this file follows it.
//
// What paging buys here is therefore the DOM and not the query: fifty rows of
// table instead of three hundred, which is the term the library's own
// measurement found was worth cutting.
//
// PURE, so the arithmetic — the counts, the clamp, the window, the empty page a
// stale link asks for — is a table of cases in test/lots-view.test.ts rather
// than something only a browser can find out.

/** How many lots a page of the index holds. */
export const PAGE_SIZE = 50;

/** What a `<form method="get">` and a `<Link>` call each of these. */
export const PARAM = { q: "q", filter: "filter", page: "page" } as const;

/**
 * The three questions this screen is asked, and no more.
 *
 * `unphotographed` is the one that blocks a catalogue: a lot with no plate
 * prints an empty box, and the sale's own header counts them. `overridden` is
 * where THIS catalogue departs from the record, which is what a second pair of
 * eyes reads before it goes to the printer. Everything else a person wants to
 * narrow by — examined, moved, in a crate — is a register of its own with its
 * own screen, and duplicating those here would be two places to keep in step.
 */
export const LOT_FILTERS = ["all", "unphotographed", "overridden"] as const;
export type LotFilter = (typeof LOT_FILTERS)[number];

const LABEL: Record<LotFilter, string> = {
  all: "All",
  unphotographed: "No photograph",
  overridden: "Overridden",
};

export interface LotsQuery {
  /** What was typed in the search box, trimmed. "" for none. */
  q: string;
  filter: LotFilter;
  /** 1-based, before clamping. */
  page: number;
}

export const DEFAULT_QUERY: LotsQuery = { q: "", filter: "all", page: 1 };

type RawParams = Record<string, string | string[] | undefined>;

/** The first value of a parameter, for a URL that repeated it. */
function one(raw: RawParams, key: string): string {
  const value = raw[key];
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

/**
 * Make sense of whatever the URL holds.
 *
 * TOTAL, as `readQuery` is in src/lib/photographs.ts and src/lib/ledger.ts:
 * anybody can put anything in a query string, and a filter that never existed
 * or a page of `banana` is not an error to show somebody, it is the default.
 */
export function readQuery(raw: RawParams): LotsQuery {
  const filter = one(raw, PARAM.filter);
  const page = Number.parseInt(one(raw, PARAM.page), 10);
  return {
    q: one(raw, PARAM.q).trim(),
    filter: (LOT_FILTERS as readonly string[]).includes(filter)
      ? (filter as LotFilter)
      : "all",
    page: Number.isFinite(page) && page > 0 ? page : 1,
  };
}

/**
 * The sale at a different query.
 *
 * The default is never written down, so `/events/<id>` stays `/events/<id>`
 * until somebody has narrowed something — the same rule as `libraryHref` and
 * `ledgerHref`, and the reason two URLs cannot mean one view.
 */
export function lotsHref(
  eventId: string,
  query: LotsQuery,
  patch: Partial<LotsQuery> = {},
): string {
  const next = { ...query, ...patch };
  const search = new URLSearchParams();
  if (next.q) search.set(PARAM.q, next.q);
  if (next.filter !== DEFAULT_QUERY.filter) search.set(PARAM.filter, next.filter);
  if (next.page > 1) search.set(PARAM.page, String(next.page));
  const qs = search.toString();
  return qs ? `/events/${eventId}?${qs}` : `/events/${eventId}`;
}

/**
 * One lot, as this screen reads it.
 *
 * ASSEMBLED BY THE PAGE FROM WHOLE-SALE QUERIES, never per lot: the
 * photographs come with the lots, and the placements, the overrides and the
 * whereabouts are each one query for the sale (`derive`, `listOverrides`,
 * `whereAreThey`). A field per lot here would be a round trip per row.
 */
export interface LotRow {
  id: string;
  ref: string | null;
  title: string;
  maker: string;
  estimate: string;
  photographs: number;
  /** Which page of the current catalogue it landed on, or null for no catalogue. */
  page: number | null;
  /** How many fields this catalogue overrides on it. */
  overrides: number;
  /**
   * Unsettled comment threads on it.
   *
   * ON THIS SCREEN AND NOT ONLY IN THE EDITOR, because the sale's index is
   * where somebody scans a hundred and sixty lots asking "what still needs
   * me". A review that can only be seen by opening the editor and turning a
   * mode on is a review that gets missed, which is the thing the whole
   * feature exists to stop.
   *
   * Settled threads are not counted: a badge that never goes away is a badge
   * people stop seeing.
   */
  comments: number;
}

// WHERE A LOT IS DOES NOT APPEAR HERE, and leaving it out was a decision. The
// movement register is a screen with that column on it, and the reason this
// file gives for having three filters rather than six applies to columns just
// as well: a second place showing a register's own fact is a second place to
// keep in step with it. This screen is the CATALOGUE's index.

export interface LotsTab {
  id: LotFilter;
  label: string;
  /** How many lots this filter holds OF WHAT THE SEARCH LEFT. */
  count: number;
  current: boolean;
  href: string;
}

export interface LotsView {
  query: LotsQuery;
  tabs: LotsTab[];
  /** The rows of the page actually shown, in the sale's own order. */
  rows: LotRow[];
  /** What the search and the filter leave, before paging. */
  matched: number;
  /** 1-based and CLAMPED — the page that is actually shown. */
  page: number;
  pages: number;
  /** 1-based inclusive positions of the first and last row on this page. */
  from: number;
  to: number;
  previous: string | null;
  next: string | null;
}

/**
 * Does this lot answer what was typed?
 *
 * REFERENCE AND TITLE, and nothing else. A search that also read the maker and
 * the medium would return a lot whose visible row explains nothing about why it
 * matched — the two columns a person scans are the two the search reads, so
 * every hit is legible where it lands. Case-folded; a reference is typed in
 * whatever case the client's file used.
 */
function matches(row: LotRow, q: string): boolean {
  if (q === "") return true;
  const needle = q.toLowerCase();
  return (
    (row.ref ?? "").toLowerCase().includes(needle) ||
    row.title.toLowerCase().includes(needle)
  );
}

function passes(row: LotRow, filter: LotFilter): boolean {
  if (filter === "unphotographed") return row.photographs === 0;
  if (filter === "overridden") return row.overrides > 0;
  return true;
}

/**
 * The view the URL asks for, from every row of the sale.
 *
 * THE COUNTS ARE OVER THE SEARCH, NOT OVER THE SALE. "No photograph 132" while
 * a search for 梅瓶 is showing four lots would be a number about a set nobody
 * is looking at — the tabs narrow what the search left, which is the same rule
 * the library states and the only one that makes the two controls composable.
 */
export function readLots(
  eventId: string,
  all: readonly LotRow[],
  query: LotsQuery,
): LotsView {
  const found = all.filter((row) => matches(row, query.q));

  const tabs: LotsTab[] = LOT_FILTERS.map((id) => ({
    id,
    label: LABEL[id],
    count: found.filter((row) => passes(row, id)).length,
    current: id === query.filter,
    // Page one on a filter change: page three of the overridden is not page
    // three of anything else, and landing past the end of a shorter view is
    // the classic paging bug.
    href: lotsHref(eventId, query, { filter: id, page: 1 }),
  }));

  const rows = found.filter((row) => passes(row, query.filter));
  const matched = rows.length;
  const pages = Math.max(1, Math.ceil(matched / PAGE_SIZE));
  const page = Math.min(query.page, pages);
  const offset = (page - 1) * PAGE_SIZE;
  const shown = rows.slice(offset, offset + PAGE_SIZE);

  return {
    query,
    tabs,
    rows: shown,
    matched,
    page,
    pages,
    from: matched === 0 ? 0 : offset + 1,
    to: offset + shown.length,
    previous: page > 1 ? lotsHref(eventId, query, { page: page - 1 }) : null,
    next: page < pages ? lotsHref(eventId, query, { page: page + 1 }) : null,
  };
}
