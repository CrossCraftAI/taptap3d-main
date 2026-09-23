// The ledger, as a function of a URL.
//
// ── WHY THERE IS ONE LEDGER AND NOT THREE ───────────────────────────────────
//
// `/catalogues` and `/exports` were the same table as the landing with a
// different verb in the last column — the same query, the same component
// (`EventChooser`), three headings. Three places that answer the same question
// is three places to look before finding out none of them was the one; and the
// rail's own note (src/lib/nav.ts) already said the verb belongs per sale
// rather than per screen, because a global "Exports" cannot know which sale
// somebody means. So the verb moved into the row, as the stage's own next
// action, and the two extra screens went with it.
//
// ── WHY THE FILTERING IS HERE AND NOT IN SQL ────────────────────────────────
//
// As built, the landing rendered every sale an org has in one table — measured
// at 250-odd rows and about 21,000px of page, with no search and no way to skip
// to a sale whose name you know. That is the defect this file exists for.
//
// It is NOT fixed by pushing the work into the query, and that is a conclusion
// rather than laziness. The stage is DERIVED (src/lib/workflow.ts) from four
// counts, in order, with a person's override winning — a rule a house can
// replace with its own workflow. Filtering by stage in SQL means writing that
// rule a second time in a dialect that cannot read the workflow, and two
// derivations of one fact disagree the first time either moves. So the org's
// sales are read once, in the one query that already counts them, and the
// search, the tab and the page are applied to the answer.
//
// The cost is a function of what an ORG holds, not of what the world holds:
// 250 rows is four correlated subqueries the query already ran and one pass of
// string matching. The day one org has tens of thousands of sales, the thing
// that must move to SQL is the SEARCH — it is the only step here that discards
// most of the rows — and the stage tabs become counts over what the search
// returned. That is a different file, and it is not needed yet.

// `factsOf` rather than a copy of it, which is the reason this module is
// SERVER-SIDE ONLY: the data layer it comes from imports the database driver,
// so anything that marks a consumer of this file `"use client"` will find out
// loudly. That is the right trade — the four counts a stage is read from are
// named once, next to the shape that holds them, and a second mapping here is
// a second thing to update the day a fifth fact lands. What a client component
// may take from this file is its TYPES, which erase.
import { factsOf, type EventSummary } from "@/lib/data/events";
import {
  isMidJob,
  readStage,
  type StageReading,
  type Workflow,
} from "@/lib/workflow";

/**
 * Rows to a page.
 *
 * Chosen from the as-built measurement rather than from taste: the landing was
 * about 21,000px for 250 sales, so a row costs roughly 84px of page. Twenty-five
 * of them is about 2,100px — a little over two screens of a 900px window, which
 * is the most scrolling that is still cheaper than pressing Next, and it leaves
 * those 250 sales at ten pages rather than twenty-five.
 *
 * Re-measure it the way it was measured: load the ledger and read the document's
 * scroll height against the row count. If a row gets taller, this gets smaller.
 */
export const PAGE_SIZE = 25;

/** The tab that is not a stage: everything still in production. */
export const OPEN = "open";
/** The tab that is not a filter at all. The archive is in here. */
export const ALL = "all";

/**
 * The orders a ledger can be read in. The first is the default.
 *
 * ── WHY THREE, AND WHY THESE ────────────────────────────────────────────────
 *
 * The screen is comparative — sixty sales, which needs me today — and search,
 * filter and pagination all shipped while the order stayed fixed at
 * newest-first with the result count saying so. Newest answers "what did we
 * just take on"; it does not answer "which is biggest" or "which is soonest",
 * and those are the other two questions a specialist asks of a column of
 * sixty. Nothing else here is a question about the whole list: the way to a
 * sale you can NAME is the search box, which is also why there is no sort by
 * name.
 *
 * Every one of them is a URL, like the tab and the page, so a sorted ledger is
 * a link somebody can send. What the control looks like is argued where it is
 * drawn (src/components/ledger.tsx).
 */
export const ORDERS = ["new", "soon", "big"] as const;
export type Order = (typeof ORDERS)[number];

export interface LedgerQuery {
  /** What was typed in the search box, trimmed and folded. "" for none. */
  q: string;
  /** `OPEN`, `ALL`, or a stage id of the workflow in force. */
  tab: string;
  /** Which of `ORDERS` the rows are in. */
  sort: Order;
  /** 1-based, before clamping. */
  page: number;
}

/** The default view: what is still in production, newest first, page one. */
export const DEFAULT_QUERY: LedgerQuery = { q: "", tab: OPEN, sort: "new", page: 1 };

/** What a `<form method="get">` and a `<Link>` call each of these. */
export const PARAM = { q: "q", tab: "stage", sort: "sort", page: "page" } as const;

type RawParams = Record<string, string | string[] | undefined>;

/** The first value of a parameter, for a URL that repeated it. */
function one(raw: RawParams, key: string): string {
  const value = raw[key];
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

/**
 * Make sense of whatever the URL holds.
 *
 * TOTAL, the way `normaliseParams` and `workflowFor` are, and for the same
 * reason: this is a query string, so anybody can put anything in it — a tab id
 * from a workflow the house has since replaced, a page number of `-3` or of
 * `banana`, the same key twice. None of that is an error a person should see.
 * A tab nobody can choose falls back to the default rather than showing an
 * empty table under a heading that names nothing.
 */
export function readQuery(raw: RawParams, workflow: Workflow): LedgerQuery {
  const wanted = one(raw, PARAM.tab);
  const known =
    wanted === OPEN || wanted === ALL || workflow.stages.some((s) => s.id === wanted);
  const page = Number.parseInt(one(raw, PARAM.page), 10);
  const sort = one(raw, PARAM.sort);
  return {
    // Folded here rather than at every comparison, so the search is
    // case-insensitive in one place. `toLowerCase` is a no-op on Chinese, which
    // is why one pass covers a name written in both scripts.
    q: one(raw, PARAM.q).trim(),
    tab: known ? wanted : DEFAULT_QUERY.tab,
    // An order this build does not have is a stale bookmark, not an error —
    // the same reading as an unknown tab, and for the same reason.
    sort: isOrder(sort) ? sort : DEFAULT_QUERY.sort,
    page: Number.isFinite(page) && page > 0 ? page : 1,
  };
}

function isOrder(value: string): value is Order {
  return (ORDERS as readonly string[]).includes(value);
}

/**
 * The ledger at a different query — a tab, a page, a search.
 *
 * EVERY CONTROL IS A URL, which is the whole reason this is a string and not a
 * click handler: a specialist who has found the four sales still being
 * photographed can send that to somebody, and it survives a reload, a back
 * button and a bookmark. It is also why the page renders on the server — there
 * is no state here that a browser has to hold.
 *
 * The default is never written down. `/` is the open sales, page one, so the
 * address stays short until somebody has actually narrowed something, and two
 * URLs cannot mean the same view.
 */
export function ledgerHref(
  query: LedgerQuery,
  patch: Partial<LedgerQuery> = {},
): "/" | `/?${string}` {
  const next = { ...query, ...patch };
  const search = new URLSearchParams();
  if (next.q) search.set(PARAM.q, next.q);
  if (next.tab !== DEFAULT_QUERY.tab) search.set(PARAM.tab, next.tab);
  if (next.sort !== DEFAULT_QUERY.sort) search.set(PARAM.sort, next.sort);
  if (next.page > 1) search.set(PARAM.page, String(next.page));
  const qs = search.toString();
  return qs ? `/?${qs}` : "/";
}

export interface LedgerRow {
  event: EventSummary;
  reading: StageReading;
  /**
   * Somebody is part-way through this sale's current step. The row's call to
   * action is painted loud for exactly these; see `isMidJob`.
   */
  midJob: boolean;
}

export interface LedgerTab {
  id: string;
  label: string;
  /** How many sales this tab holds OF WHAT THE SEARCH LEFT. */
  count: number;
  current: boolean;
  href: "/" | `/?${string}`;
}

export interface LedgerOrder {
  id: Order;
  /** The control's word: Newest, Soonest, Biggest. */
  label: string;
  /** How the result count says it: "…, newest first". */
  first: string;
  current: boolean;
  href: "/" | `/?${string}`;
}

export interface LedgerView {
  query: LedgerQuery;
  tabs: LedgerTab[];
  orders: LedgerOrder[];
  /** This page's rows, in the order the query asked for. */
  rows: LedgerRow[];
  /** Every sale the org has, before the search and the tab. */
  total: number;
  /**
   * Sales still in production, of ALL of them — not of what the search left.
   * The heading says it, so it must not move when somebody types.
   */
  open: number;
  /** What the search and the tab leave. */
  matched: number;
  /** 1-based and CLAMPED — what is actually shown, not what was asked for. */
  page: number;
  pages: number;
  /** 1-based inclusive positions of the first and last row shown. */
  from: number;
  to: number;
  /** Null at the ends, so a control with nowhere to go is not rendered. */
  previous: "/" | `/?${string}` | null;
  next: "/" | `/?${string}` | null;
}

/** A sale is OPEN while its workflow has somewhere further to go. */
function isOpen(reading: StageReading): boolean {
  return reading.index < reading.workflow.stages.length - 1;
}

/**
 * Does this sale's name contain what was typed?
 *
 * ONE FIELD, BOTH SCRIPTS. A Hong Kong sale is named 「中國古代陶瓷及工藝精品 Fine
 * Chinese Ceramics」 in one column, so a substring test over it answers a
 * Chinese query and an English one without knowing which was typed — and
 * without a tokeniser, which is the thing that would have to be right for
 * Chinese and is not needed to find a name you already know.
 *
 * Substring rather than prefix, because the English half of a bilingual name
 * never starts the string. No normalisation beyond case: the alternative is
 * deciding whether 「台」 should match 「臺」, which is a real question for a
 * search over CATALOGUE TEXT and is not one for a list of sixty sale names.
 */
function matches(name: string, q: string): boolean {
  return q === "" || name.toLowerCase().includes(q.toLowerCase());
}

/**
 * The three orders, with the word each one puts in the count sentence.
 *
 * NEWEST HAS NO COMPARATOR ON PURPOSE. `listEvents` already orders by
 * `created_at` descending, so re-sorting here would be the same rule written a
 * second time in a second place — which is the disagreement this file's own
 * header refuses for the stage and src/lib/data/events.ts warns about for the
 * counts. The default is therefore "as the query returned it", and the test
 * that proves it hands `readLedger` a deliberately un-ordered list and asserts
 * it comes back untouched.
 *
 * THE OTHER TWO SORT A COPY, STABLY. `Array.prototype.sort` has been required
 * to be stable since ES2019, so two sales of the same size or the same date
 * keep the order they arrived in — which is newest-first, and is a better
 * second key than anything that could be invented here.
 */
const ORDER: Record<
  Order,
  { label: string; first: string; by: ((a: LedgerRow, b: LedgerRow) => number) | null }
> = {
  new: { label: "Newest", first: "newest", by: null },
  soon: { label: "Soonest", first: "soonest", by: bySoonest },
  big: { label: "Biggest", first: "biggest", by: byBiggest },
};

/**
 * Nearest date held first, undated last.
 *
 * ASCENDING, WHICH PUTS A DATE ALREADY PAST AT THE TOP, and that is the right
 * end for it: the default tab is the sales still in production, and one of
 * those whose date has gone is the most urgent row on the screen, not the
 * least. A sale with no date has no deadline and cannot be the soonest, so it
 * sorts after every sale that has one — never mixed in as "the beginning of
 * time", which is what a null read as zero would do.
 */
function bySoonest(a: LedgerRow, b: LedgerRow): number {
  const x = a.event.heldOn?.getTime() ?? Number.POSITIVE_INFINITY;
  const y = b.event.heldOn?.getTime() ?? Number.POSITIVE_INFINITY;
  // Written as a comparison rather than `x - y`, because two undated sales
  // would otherwise subtract two infinities and hand the sort a NaN.
  return x === y ? 0 : x < y ? -1 : 1;
}

/** Most lots first. The count is the one measure of size this screen has. */
function byBiggest(a: LedgerRow, b: LedgerRow): number {
  return b.event.lotCount - a.event.lotCount;
}

/**
 * The ledger the URL asks for.
 *
 * PURE: sales in, a view out, no database and no request — so the paging
 * arithmetic, the tab counts and the fallbacks are a table of cases in
 * test/ledger.test.ts rather than something only a browser can find out.
 *
 * The tabs are the WORKFLOW'S, in its order, and this function knows none of
 * their names. A house-authored workflow with three stages gets three stage
 * tabs, in its own words, with no change here — which is the same promise the
 * progress column already makes.
 *
 * SEARCH, THEN TAB, THEN ORDER, THEN PAGE, and each step is in that place for
 * its own reason: a tab's count has to be of what the search left, the order
 * has to be of what the tab left or page two is a page of a different list,
 * and the page is a cut taken last — which is the only sequence in which
 * "Showing 1–25 of 60, biggest first" is a true sentence.
 */
export function readLedger(
  events: EventSummary[],
  workflow: Workflow,
  query: LedgerQuery,
): LedgerView {
  const all: LedgerRow[] = events.map((event) => {
    const reading = readStage(workflow, factsOf(event), event.stageOverride);
    return { event, reading, midJob: isMidJob(reading) };
  });

  // The search narrows first, so every tab's count says what pressing it would
  // give — a tab reading "12" that lands on an empty table is the defect a
  // faceted count exists to prevent.
  const found = all.filter((row) => matches(row.event.name, query.q));
  const inTab = (row: LedgerRow, tab: string): boolean =>
    tab === ALL || (tab === OPEN ? isOpen(row.reading) : row.reading.stage.id === tab);

  const tabs: LedgerTab[] = [
    { id: OPEN, label: "Open" },
    ...workflow.stages.map((stage) => ({ id: stage.id, label: stage.label.en })),
    { id: ALL, label: "All" },
  ].map(({ id, label }) => ({
    id,
    label,
    count: found.filter((row) => inTab(row, id)).length,
    current: id === query.tab,
    // Changing the tab returns to page one: page seven of the open sales is
    // not page seven of anything else, and landing on an empty page because
    // the previous view was longer is the classic paging bug.
    href: ledgerHref(query, { tab: id, page: 1 }),
  }));

  // The order changes what is on page one, so pressing one starts again at
  // page one — the same rule as a tab, and the same paging bug avoided.
  const orders: LedgerOrder[] = ORDERS.map((id) => ({
    id,
    label: ORDER[id].label,
    first: ORDER[id].first,
    current: id === query.sort,
    href: ledgerHref(query, { sort: id, page: 1 }),
  }));

  const inThisTab = found.filter((row) => inTab(row, query.tab));
  const by = ORDER[query.sort].by;
  const matched = by ? [...inThisTab].sort(by) : inThisTab;
  const pages = Math.max(1, Math.ceil(matched.length / PAGE_SIZE));
  // CLAMPED, not refused. A stale link to page nine of a view that has since
  // shrunk to four shows page four, because the sales are what somebody came
  // for and the page number was never the point.
  const page = Math.min(query.page, pages);
  const start = (page - 1) * PAGE_SIZE;
  const rows = matched.slice(start, start + PAGE_SIZE);

  return {
    query,
    tabs,
    orders,
    rows,
    total: events.length,
    open: all.filter((row) => isOpen(row.reading)).length,
    matched: matched.length,
    page,
    pages,
    from: rows.length === 0 ? 0 : start + 1,
    to: start + rows.length,
    previous: page > 1 ? ledgerHref(query, { page: page - 1 }) : null,
    next: page < pages ? ledgerHref(query, { page: page + 1 }) : null,
  };
}
