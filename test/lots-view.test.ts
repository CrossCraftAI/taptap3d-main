// The sale's index as a function of its URL.
//
// Modelled on test/photographs.test.ts, which is modelled on test/ledger.test.ts,
// because all three answer the same shape of question: a query string anybody
// can type goes in, and a view that must be internally consistent comes out. The
// things that go wrong are arithmetic — a tab whose count is of a different set
// from the rows beneath it, a stale link to a page that no longer exists, a
// "showing 1–50 of 0", two URLs that mean one view.

import { describe, expect, it } from "vitest";

import {
  DEFAULT_QUERY,
  LOT_FILTERS,
  PAGE_SIZE,
  PARAM,
  lotsHref,
  readLots,
  readQuery,
  type LotRow,
} from "@/lib/lots-view";

const EVENT = "e1";

function lot(n: number, over: Partial<LotRow> = {}): LotRow {
  return {
    id: `l${n}`,
    ref: `P${String(n).padStart(3, "0")}`,
    title: `青花梅瓶 ${n}`,
    maker: "佚名",
    estimate: "HK$40,000–80,000",
    photographs: 1,
    page: 1,
    overrides: 0,
    ...over,
  };
}

const sale = (n: number, over: (i: number) => Partial<LotRow> = () => ({})): LotRow[] =>
  Array.from({ length: n }, (_, i) => lot(i + 1, over(i + 1)));

describe("whatever the URL holds is read as a view", () => {
  it("takes the three parameters", () => {
    expect(readQuery({ q: " 梅瓶 ", filter: "overridden", page: "3" })).toEqual({
      q: "梅瓶",
      filter: "overridden",
      page: 3,
    });
  });

  it("falls back rather than failing, for anything a person can type", () => {
    // A query string is public. None of this is an error to show somebody.
    expect(readQuery({ filter: "banana", page: "-3" })).toEqual(DEFAULT_QUERY);
    expect(readQuery({ page: "banana" })).toEqual(DEFAULT_QUERY);
    expect(readQuery({})).toEqual(DEFAULT_QUERY);
    // A URL that repeated a key takes the first, rather than an array.
    expect(readQuery({ filter: ["overridden", "all"] }).filter).toBe("overridden");
  });
});

describe("a URL means one view, and the default is never written down", () => {
  it("leaves the plain address plain", () => {
    expect(lotsHref(EVENT, DEFAULT_QUERY)).toBe("/events/e1");
    expect(lotsHref(EVENT, DEFAULT_QUERY, { page: 1, filter: "all" })).toBe("/events/e1");
  });

  it("writes only what was narrowed", () => {
    expect(lotsHref(EVENT, DEFAULT_QUERY, { filter: "unphotographed" })).toBe(
      `/events/e1?${PARAM.filter}=unphotographed`,
    );
    expect(lotsHref(EVENT, DEFAULT_QUERY, { page: 2 })).toBe(`/events/e1?${PARAM.page}=2`);
  });

  it("round-trips through the reader", () => {
    const query = { q: "梅瓶", filter: "overridden" as const, page: 4 };
    const href = lotsHref(EVENT, query);
    const raw = Object.fromEntries(new URL(`http://x${href}`).searchParams);
    expect(readQuery(raw)).toEqual(query);
  });
});

describe("the counts are over the search, and the rows are over both", () => {
  const all = sale(10, (i) => ({
    photographs: i <= 4 ? 0 : 1,
    overrides: i === 3 || i === 9 ? 2 : 0,
    title: i <= 6 ? `青花梅瓶 ${i}` : `粉彩筆筒 ${i}`,
  }));

  it("narrows the tabs to what the search left", () => {
    // Six lots match 梅瓶; four of those have no photograph.
    const view = readLots(EVENT, all, { ...DEFAULT_QUERY, q: "梅瓶" });
    expect(view.tabs.find((t) => t.id === "all")!.count).toBe(6);
    expect(view.tabs.find((t) => t.id === "unphotographed")!.count).toBe(4);
    // A number about a set nobody is looking at is the bug this prevents: the
    // whole sale has four unphotographed too, but only because they all match.
    expect(view.tabs.find((t) => t.id === "overridden")!.count).toBe(1);
  });

  it("searches the reference as well as the title, case-folded", () => {
    expect(readLots(EVENT, all, { ...DEFAULT_QUERY, q: "p003" }).matched).toBe(1);
    expect(readLots(EVENT, all, { ...DEFAULT_QUERY, q: "P00" }).matched).toBe(9);
  });

  it("returns the rows the filter leaves, not the rows the search left", () => {
    const view = readLots(EVENT, all, { ...DEFAULT_QUERY, filter: "unphotographed" });
    expect(view.rows).toHaveLength(4);
    expect(view.rows.every((r) => r.photographs === 0)).toBe(true);
    expect(view.matched).toBe(4);
  });

  it("changing the filter goes back to page one", () => {
    const view = readLots(EVENT, all, { ...DEFAULT_QUERY, page: 3 });
    for (const tab of view.tabs) expect(tab.href).not.toContain(`${PARAM.page}=`);
  });
});

describe("paging, including the pages a stale link asks for", () => {
  const all = sale(PAGE_SIZE * 2 + 7);

  it("cuts the DOM and says which window it cut", () => {
    const first = readLots(EVENT, all, DEFAULT_QUERY);
    expect(first.rows).toHaveLength(PAGE_SIZE);
    expect([first.from, first.to]).toEqual([1, PAGE_SIZE]);
    expect(first.pages).toBe(3);
    expect(first.previous).toBeNull();
    expect(first.next).toBe(`/events/e1?${PARAM.page}=2`);

    const last = readLots(EVENT, all, { ...DEFAULT_QUERY, page: 3 });
    expect(last.rows).toHaveLength(7);
    expect([last.from, last.to]).toEqual([PAGE_SIZE * 2 + 1, PAGE_SIZE * 2 + 7]);
    expect(last.next).toBeNull();
  });

  it("clamps a page past the end rather than showing an empty one", () => {
    // The stale-link case: page 9 of a view that has since shrunk. Landing on
    // nothing, with a Previous that goes to page 8 of nothing, is the failure.
    const view = readLots(EVENT, all, { ...DEFAULT_QUERY, page: 9 });
    expect(view.page).toBe(3);
    expect(view.rows).toHaveLength(7);
    expect(view.next).toBeNull();
  });

  it("an empty result is 0 of 0, never 1–0 of 0", () => {
    const view = readLots(EVENT, all, { ...DEFAULT_QUERY, q: "nothing matches this" });
    expect(view.matched).toBe(0);
    expect([view.from, view.to]).toEqual([0, 0]);
    expect(view.pages).toBe(1);
    expect(view.previous).toBeNull();
    expect(view.next).toBeNull();
  });
});

describe("the sale's own order survives every view", () => {
  it("never re-sorts, because the running order IS the catalogue", () => {
    // The list arrives in `position` order and that order is editorial — lot 1
    // is the opener. A screen that sorted by anything else would be showing a
    // sale that does not exist.
    const all = sale(12, (i) => ({ photographs: i % 2 === 0 ? 0 : 1 }));
    const view = readLots(EVENT, all, { ...DEFAULT_QUERY, filter: "unphotographed" });
    expect(view.rows.map((r) => r.ref)).toEqual([
      "P002",
      "P004",
      "P006",
      "P008",
      "P010",
      "P012",
    ]);
  });
});

describe("the filters are the three this screen is about", () => {
  it("and adding a fourth is a decision, not an accident", () => {
    // Every register this product has could contribute a filter here. The
    // three are the catalogue's own; the rest have screens of their own, and
    // two places to keep in step is how they come apart.
    expect([...LOT_FILTERS]).toEqual(["all", "unphotographed", "overridden"]);
  });
});
