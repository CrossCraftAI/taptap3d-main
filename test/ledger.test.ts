// The ledger, as a function of a URL.
//
// Everything a person can do to this screen — search it, filter it, page
// through it — is a query string, so the whole of it is testable here without
// a browser. What the driven suite still has to say is whether the row is a
// door and whether the table is legible; what THIS has to say is that a stale
// bookmark, a repeated parameter, a page past the end and an unknown stage all
// land somewhere sensible, because those are the cases a person hits by
// sharing a link and nobody hits by clicking around.

import { describe, expect, it } from "vitest";

import type { EventSummary } from "@/lib/data/events";
import {
  ALL,
  DEFAULT_QUERY,
  OPEN,
  PAGE_SIZE,
  ledgerHref,
  readLedger,
  readQuery,
  type LedgerQuery,
} from "@/lib/ledger";
import { CATALOGUE_PRODUCTION, workflowSchema, type WorkflowInput } from "@/lib/workflow";

const W = CATALOGUE_PRODUCTION;

/** A sale, at whatever counts are given. The stage falls out of them. */
function sale(
  name: string,
  counts: Partial<Pick<EventSummary, "lotCount" | "photographedCount" | "catalogueCount" | "exportedCount" | "stageOverride">> = {},
): EventSummary {
  return {
    id: name,
    name,
    heldOn: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    lotCount: 0,
    photographedCount: 0,
    catalogueCount: 0,
    exportedCount: 0,
    stageOverride: null,
    ...counts,
  };
}

const NEW = sale("春季拍賣 Spring Sale");
const RECORDED = sale("Jewellery", { lotCount: 10 });
const MIDWAY = sale("Ceramics", { lotCount: 10, photographedCount: 4 });
const PHOTOGRAPHED = sale("Paintings", { lotCount: 10, photographedCount: 10 });
const EXPORTED = sale("近現代書畫 Modern Ink", {
  lotCount: 10,
  photographedCount: 10,
  catalogueCount: 1,
  exportedCount: 1,
});
const SALES = [NEW, RECORDED, MIDWAY, PHOTOGRAPHED, EXPORTED];

const view = (query: Partial<LedgerQuery> = {}, events = SALES) =>
  readLedger(events, W, { ...DEFAULT_QUERY, ...query });

describe("what the URL is allowed to say", () => {
  it("reads the three parameters", () => {
    expect(readQuery({ q: " 青花 ", stage: "recorded", page: "3" }, W)).toEqual({
      q: "青花",
      tab: "recorded",
      page: 3,
    });
  });

  it.each<[string, Record<string, string | string[] | undefined>]>([
    ["nothing at all", {}],
    ["a stage the workflow does not have", { stage: "shipped" }],
    ["a stage from a workflow the house replaced", { stage: "consign" }],
    ["an empty stage", { stage: "" }],
  ])("falls %s back to the open sales", (_what, raw) => {
    expect(readQuery(raw, W).tab).toBe(OPEN);
  });

  it.each([["banana"], ["-3"], ["0"], [""], ["1e9999"]])(
    "reads the page %s as page one",
    (page) => {
      // 1e9999 parses to Infinity, which is not a page and is not an error
      // either — somebody edited the address bar.
      expect(readQuery({ page }, W).page).toBe(1);
    },
  );

  it("takes the first of a repeated parameter", () => {
    // `?q=a&q=b` is a URL a form can produce by accident; it is not a crash.
    expect(readQuery({ q: ["a", "b"], page: ["2", "9"] }, W)).toMatchObject({ q: "a", page: 2 });
  });

  it("keeps `all` and `open`, which are not stages", () => {
    expect(readQuery({ stage: ALL }, W).tab).toBe(ALL);
    expect(readQuery({ stage: OPEN }, W).tab).toBe(OPEN);
  });
});

describe("the address a control points at", () => {
  it("writes nothing down for the default view", () => {
    // Two URLs must not mean the same screen, and the short one is the one a
    // person sees first.
    expect(ledgerHref(DEFAULT_QUERY)).toBe("/");
    expect(ledgerHref({ q: "", tab: OPEN, page: 1 })).toBe("/");
  });

  it("carries only what is not the default", () => {
    expect(ledgerHref(DEFAULT_QUERY, { tab: "recorded" })).toBe("/?stage=recorded");
    expect(ledgerHref(DEFAULT_QUERY, { page: 4 })).toBe("/?page=4");
    expect(ledgerHref({ q: "jade", tab: ALL, page: 2 })).toBe("/?q=jade&stage=all&page=2");
  });

  it("survives a Chinese search, which is what these names are", () => {
    const href = ledgerHref(DEFAULT_QUERY, { q: "青花" });
    expect(href).toBe("/?q=%E9%9D%92%E8%8A%B1");
    expect(new URL(href, "https://x").searchParams.get("q")).toBe("青花");
  });

  it("round-trips through readQuery", () => {
    for (const query of [
      { q: "青花", tab: ALL, page: 3 },
      { q: "", tab: "photographed", page: 1 },
      { q: "a b", tab: OPEN, page: 1 },
    ] satisfies LedgerQuery[]) {
      const url = new URL(ledgerHref(query), "https://x");
      expect(readQuery(Object.fromEntries(url.searchParams), W)).toEqual(query);
    }
  });
});

describe("open is the default, and the archive is one press away", () => {
  it("leaves out the sale that has been exported", () => {
    expect(view().rows.map((r) => r.event.name)).not.toContain(EXPORTED.name);
    expect(view().matched).toBe(4);
  });

  it("shows it under its own stage, and under all", () => {
    expect(view({ tab: "exported" }).rows.map((r) => r.event.name)).toEqual([EXPORTED.name]);
    expect(view({ tab: ALL }).matched).toBe(5);
  });

  it("counts the open sales over every sale, not over the search", () => {
    // The heading says "4 open · 5 in all" and must not move when somebody
    // types into the search box.
    expect(view({ q: "Jewellery" }).open).toBe(4);
    expect(view({ q: "Jewellery" }).total).toBe(5);
    expect(view({ q: "Jewellery" }).matched).toBe(1);
  });

  it("follows a person's answer, not the data's", () => {
    // Somebody marked a finished-looking sale as back at the beginning. It is
    // open, because that is what they said (principle 9).
    const said = sale("Reissued", {
      lotCount: 10,
      photographedCount: 10,
      catalogueCount: 1,
      exportedCount: 1,
      stageOverride: "recorded",
    });
    expect(readLedger([said], W, DEFAULT_QUERY).rows).toHaveLength(1);
  });
});

describe("the tabs are the workflow's", () => {
  it("are open, then every stage in order, then all", () => {
    expect(view().tabs.map((t) => t.id)).toEqual([
      OPEN,
      ...W.stages.map((s) => s.id),
      ALL,
    ]);
  });

  it("count what the search left, so pressing one is never empty", () => {
    // THE DEFECT A FACETED COUNT EXISTS TO PREVENT: a tab reading 12 that
    // lands on an empty table because the search was not applied to it.
    const searched = view({ q: "e" });
    for (const tab of searched.tabs) {
      expect(view({ q: "e", tab: tab.id }).matched, tab.id).toBe(tab.count);
    }
  });

  it("knows none of the built-in's names", () => {
    // A gallery's workflow, three stages, its own words — the same function,
    // three stage tabs, no change anywhere.
    const gallery = workflowSchema.parse({
      id: "gallery-show",
      name: { zh: "畫廊展覽", en: "Gallery show" },
      stages: [
        { id: "planned", label: { zh: "籌備中", en: "Planned" }, next: { label: { zh: "匯入", en: "Import" }, to: "import" } },
        { id: "hung", label: { zh: "已佈展", en: "Hung" }, when: [{ fact: "lots", atLeast: 1 }], next: { label: { zh: "單張", en: "Tearsheets" }, to: "catalogue" } },
        { id: "printed", label: { zh: "已印製", en: "Printed" }, when: [{ fact: "exported" }], next: { label: { zh: "再下載", en: "Again" }, to: "pdf" } },
      ],
    } satisfies WorkflowInput);
    const out = readLedger(SALES, gallery, { ...DEFAULT_QUERY, tab: OPEN });
    expect(out.tabs.map((t) => t.label)).toEqual(["Open", "Planned", "Hung", "Printed", "All"]);
  });
});

describe("the search", () => {
  it("finds a bilingual name from either script", () => {
    expect(view({ q: "青花", tab: ALL }).matched).toBe(0);
    expect(view({ q: "書畫", tab: ALL }).rows.map((r) => r.event.name)).toEqual([EXPORTED.name]);
    expect(view({ q: "modern ink", tab: ALL }).rows.map((r) => r.event.name)).toEqual([EXPORTED.name]);
  });

  it("ignores case on the Latin half and is unbothered by the Chinese one", () => {
    expect(view({ q: "JEWELLERY", tab: ALL }).matched).toBe(1);
  });

  it("matches inside the name, because the English half never starts it", () => {
    expect(view({ q: "Spring", tab: ALL }).rows.map((r) => r.event.name)).toEqual([NEW.name]);
  });

  it("finds nothing rather than everything when nothing matches", () => {
    const out = view({ q: "no such sale", tab: ALL });
    expect(out.rows).toEqual([]);
    expect(out.matched).toBe(0);
    expect(out.from).toBe(0);
    expect(out.to).toBe(0);
  });
});

describe("paging", () => {
  const many = Array.from({ length: PAGE_SIZE * 2 + 3 }, (_, i) =>
    sale(`Sale ${String(i).padStart(3, "0")}`, { lotCount: 1 }),
  );

  it("cuts the list at the page size and says where it is", () => {
    const first = readLedger(many, W, DEFAULT_QUERY);
    expect(first.rows).toHaveLength(PAGE_SIZE);
    expect(first).toMatchObject({ page: 1, pages: 3, from: 1, to: PAGE_SIZE, previous: null });
    expect(first.next).toBe("/?page=2");
  });

  it("keeps the order the query gave, across the cut", () => {
    const first = readLedger(many, W, DEFAULT_QUERY);
    const second = readLedger(many, W, { ...DEFAULT_QUERY, page: 2 });
    expect([...first.rows, ...second.rows].map((r) => r.event.name)).toEqual(
      many.slice(0, PAGE_SIZE * 2).map((e) => e.name),
    );
  });

  it("has nowhere further to go on the last page", () => {
    const last = readLedger(many, W, { ...DEFAULT_QUERY, page: 3 });
    expect(last.next).toBeNull();
    expect(last.previous).toBe("/?page=2");
    expect(last.to).toBe(many.length);
  });

  it("clamps a stale link rather than showing an empty page", () => {
    // Somebody sent page nine of a view that has since shrunk. The sales are
    // what they came for; the page number never was.
    const out = readLedger(many, W, { ...DEFAULT_QUERY, page: 99 });
    expect(out.page).toBe(3);
    expect(out.rows).toHaveLength(3);
  });

  it("is one page when there is nothing at all", () => {
    const out = readLedger([], W, DEFAULT_QUERY);
    expect(out).toMatchObject({ page: 1, pages: 1, from: 0, to: 0, total: 0, previous: null, next: null });
  });

  it("sends a tab back to page one", () => {
    // Page seven of the open sales is not page seven of anything else.
    const out = readLedger(many, W, { ...DEFAULT_QUERY, page: 3 });
    for (const tab of out.tabs) expect(tab.href).not.toContain("page=");
  });
});

describe("which call to action is loud", () => {
  const loud = (event: EventSummary): boolean =>
    readLedger([event], W, { ...DEFAULT_QUERY, tab: ALL }).rows[0]!.midJob;

  it.each<[string, EventSummary, boolean]>([
    // Nobody has started: a job to schedule, and the row is quiet.
    ["a sale with no lots", NEW, false],
    ["lots in, not one plate taken", RECORDED, false],
    // Somebody stopped halfway. This is the one thing the stage label cannot
    // say — "Recorded" reads the same at 4 of 10 as at 0 of 10.
    ["four plates of ten", MIDWAY, true],
    ["every plate taken", PHOTOGRAPHED, false],
    ["printed", EXPORTED, false],
  ])("%s", (_what, event, expected) => {
    expect(loud(event)).toBe(expected);
  });

  it("is rare, which is the whole reason it is worth anything", () => {
    // A column of sixty accents is no accent. On the fixture, one row of five.
    expect(view({ tab: ALL }).rows.filter((r) => r.midJob)).toHaveLength(1);
  });
});
