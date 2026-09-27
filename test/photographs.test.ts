// The photograph library as a function of a URL.
//
// The library rendered every tile the org held into one document — measured at
// 1,475,396 bytes of HTML for 424 photographs on a production build, 775 bytes
// of it per tile. What replaces that is a page, and the things that go wrong
// with a page are arithmetic: a tab whose count is of a different set from the
// grid under it, a stale link to a page that no longer exists, a "showing
// 1–48 of 0", and an address that means two different views.
//
// So this is a table of cases, the way test/ledger.test.ts is for the screen
// this one is modelled on.

import { describe, expect, it } from "vitest";

import {
  DEFAULT_QUERY,
  libraryHref,
  PAGE_SIZE,
  PARAM,
  readLibrary,
  readQuery,
  shortName,
  type LibraryCounts,
  type LibraryQuery,
} from "@/lib/photographs";

const counts = (all: number, unassigned: number): LibraryCounts => ({
  all,
  unassigned,
  assigned: all - unassigned,
});

const query = (patch: Partial<LibraryQuery> = {}): LibraryQuery => ({
  ...DEFAULT_QUERY,
  ...patch,
});

describe("what the URL says", () => {
  it.each([
    [{}, DEFAULT_QUERY],
    [{ filter: "unassigned" }, query({ filter: "unassigned" })],
    [{ filter: "assigned" }, query({ filter: "assigned" })],
    // TOTAL over anything a query string can hold. Every one of these is
    // somebody's stale bookmark or somebody's typing, and none of them is an
    // error a person should be shown.
    [{ filter: "on-a-lot" }, DEFAULT_QUERY],
    [{ filter: "" }, DEFAULT_QUERY],
    [{ page: "3" }, query({ page: 3 })],
    [{ page: "0" }, DEFAULT_QUERY],
    [{ page: "-3" }, DEFAULT_QUERY],
    [{ page: "banana" }, DEFAULT_QUERY],
    [{ q: "  IMG_44  " }, query({ q: "IMG_44" })],
    // The same key twice: the first value, as `one()` in the ledger does.
    [{ filter: ["unassigned", "assigned"] }, query({ filter: "unassigned" })],
  ] as const)("%j", (raw, expected) => {
    expect(readQuery(raw as Record<string, string | string[]>)).toEqual(expected);
  });
});

describe("the address of a view", () => {
  it("writes nothing down for the default", () => {
    // Two URLs must not mean one view, and `/photographs` is the one a person
    // arrives at from the rail.
    expect(libraryHref(DEFAULT_QUERY)).toBe("/photographs");
    expect(libraryHref(query({ page: 1 }))).toBe("/photographs");
  });

  it("carries only what was narrowed", () => {
    expect(libraryHref(query({ filter: "unassigned" }))).toBe(
      `/photographs?${PARAM.filter}=unassigned`,
    );
    expect(libraryHref(query({ page: 4 }))).toBe(`/photographs?${PARAM.page}=4`);
    expect(libraryHref(query({ q: "IMG 44", filter: "assigned", page: 2 }))).toBe(
      "/photographs?q=IMG+44&filter=assigned&page=2",
    );
  });

  it("patches one thing and keeps the rest", () => {
    const from = query({ q: "4471", filter: "unassigned", page: 6 });
    expect(libraryHref(from, { page: 7 })).toContain("page=7");
    expect(libraryHref(from, { page: 7 })).toContain("q=4471");
    expect(libraryHref(from, { q: "", page: 1 })).toBe(
      `/photographs?${PARAM.filter}=unassigned`,
    );
  });
});

describe("the tabs count what the search left", () => {
  it("takes its numbers from the one query that made them", () => {
    // A tab reading "12" that lands on an empty grid is the defect a faceted
    // count exists to prevent, so the counts handed in here are already of
    // the search — `countLibrary` applies it — and nothing in this module
    // recounts anything.
    const view = readLibrary(counts(90, 30), query({ filter: "unassigned" }));
    expect(view.tabs.map((t) => [t.id, t.count])).toEqual([
      ["all", 90],
      ["unassigned", 30],
      ["assigned", 60],
    ]);
    expect(view.matched).toBe(30);
  });

  it("marks exactly one tab, and sends every tab to page one", () => {
    const view = readLibrary(counts(90, 30), query({ filter: "assigned", page: 9 }));
    expect(view.tabs.filter((t) => t.current).map((t) => t.id)).toEqual(["assigned"]);
    for (const tab of view.tabs) expect(tab.href).not.toContain("page=");
  });

  it("keeps the search when the filter changes", () => {
    // Searching inside the unassigned pile and then pressing "All" is still
    // the same search. Only the page is dropped.
    const view = readLibrary(counts(4, 4), query({ q: "4471", filter: "unassigned" }));
    for (const tab of view.tabs) expect(tab.href).toContain("q=4471");
  });
});

describe("the page is a window the database is asked for", () => {
  it("asks for the first page by default", () => {
    const view = readLibrary(counts(200, 0), DEFAULT_QUERY);
    expect([view.offset, view.limit]).toEqual([0, PAGE_SIZE]);
    expect([view.from, view.to]).toEqual([1, PAGE_SIZE]);
    expect(view.pages).toBe(Math.ceil(200 / PAGE_SIZE));
    expect(view.previous).toBeNull();
    expect(view.next).toContain("page=2");
  });

  it("counts the last page short, not full", () => {
    // The sentence under the grid says what is shown of what exists, and a
    // last page that claimed a full window would be the one number on this
    // screen a reader could check by counting tiles and find wrong.
    const view = readLibrary(counts(PAGE_SIZE + 3, 0), query({ page: 2 }));
    expect(view.from).toBe(PAGE_SIZE + 1);
    expect(view.to).toBe(PAGE_SIZE + 3);
    expect(view.next).toBeNull();
    expect(view.previous).toBe("/photographs");
  });

  it("clamps a page past the end rather than refusing it", () => {
    // A stale link to page nine of a view that has since shrunk to two shows
    // page two: the photographs are what somebody came for and the page
    // number was never the point. Clamping BEFORE the query is the whole
    // reason this module returns an offset instead of taking rows.
    const view = readLibrary(counts(PAGE_SIZE + 1, 0), query({ page: 9 }));
    expect(view.page).toBe(2);
    expect(view.pages).toBe(2);
    expect(view.offset).toBe(PAGE_SIZE);
    expect(view.to).toBe(PAGE_SIZE + 1);
  });

  it("has one page and no pager when there is nothing", () => {
    const view = readLibrary(counts(0, 0), query({ filter: "unassigned", page: 5 }));
    expect([view.page, view.pages]).toEqual([1, 1]);
    expect([view.from, view.to]).toEqual([0, 0]);
    expect([view.previous, view.next]).toEqual([null, null]);
    // Nought of nought, and not "1–0 of 0": the screen says "Nothing here".
    expect(view.matched).toBe(0);
  });

  it("has no pager at exactly a page's worth", () => {
    const view = readLibrary(counts(PAGE_SIZE, 0), DEFAULT_QUERY);
    expect(view.pages).toBe(1);
    expect(view.next).toBeNull();
  });

  it("never asks for more than a page, whatever the counts say", () => {
    // The limit is what the query gets. A view that widened it would undo the
    // whole change quietly, on exactly the house with the most photographs.
    for (const total of [0, 1, PAGE_SIZE - 1, PAGE_SIZE, PAGE_SIZE * 40 + 7]) {
      for (const page of [1, 2, 40]) {
        const view = readLibrary(counts(total, 0), query({ page }));
        expect(view.limit).toBe(PAGE_SIZE);
        expect(view.to - view.offset).toBeLessThanOrEqual(PAGE_SIZE);
      }
    }
  });
});

describe("the page is big enough for the gesture it exists for", () => {
  it("holds the run this screen was built to select", () => {
    // src/components/photograph-library.tsx states the common case as forty
    // consecutive photographs assigned to one lot, and the selection is what
    // is on screen — so a page smaller than the run would break the gesture
    // in half. This is the floor under PAGE_SIZE; the ceiling is the window,
    // and that one is argued where the number is declared.
    expect(PAGE_SIZE).toBeGreaterThanOrEqual(40);
  });
});

describe("a filename is cut in the middle, because the end is what differs", () => {
  // The inspection loop found a grid of forty-eight tiles every one of which
  // read `insp-1790488754792-…`. Every name a camera writes shares a prefix.
  it("keeps the head and the tail of a long name", () => {
    const out = shortName("insp-1790488754792-13.png");
    expect(out.startsWith("insp-")).toBe(true);
    expect(out.endsWith("13.png")).toBe(true);
    expect(out).toContain("…");
  });

  it("tells two photographs from one shoot apart, which truncation does not", () => {
    const a = shortName("2026-03-ming-vases-014.jpg");
    const b = shortName("2026-03-ming-vases-015.jpg");
    expect(a).not.toBe(b);
  });

  it("leaves a short name alone, extension and all", () => {
    expect(shortName("IMG_4471.CR2")).toBe("IMG_4471.CR2");
    expect(shortName("a.png")).toBe("a.png");
  });

  it("never starves either end, whatever it is given", () => {
    // A name with no extension and no structure is the worst case for any
    // middle-out rule; it must still show something from both ends.
    const out = shortName("x".repeat(120));
    expect(out.length).toBeLessThanOrEqual(26);
    expect(out.indexOf("…")).toBeGreaterThanOrEqual(4);
  });
});
