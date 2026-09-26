// The field policy screen, as a function of what the house holds.
//
// `orgs.field_policy` is the one column in this product whose failure is not
// recoverable at any price: a reserve that reaches a printed catalogue cannot
// be unprinted. test/visibility.test.ts holds the READER — what the engine
// does with a stored map — and this holds the WRITER's arithmetic: which
// fields a screen offers, and what it stores when somebody presses Save.
//
// The case that matters most is the dullest one. A house that has said nothing
// must go on printing exactly what it printed yesterday, and a screen that
// draws a control for forty fields and stores forty answers would be
// behaviourally identical today and a different sentence to anything that ever
// asks whether the house has a policy at all.

import { describe, expect, it } from "vitest";

import { policyFor } from "@/lib/engine/visibility";
import { CORE_FIELD_KEYS } from "@/lib/import/fields";
import { MAX_KEY, policyOf, policyRows } from "@/lib/settings";

const RESERVE = "保留價";
const CONSIGNOR = "委託人";

/** What `listFieldKeys` hands over: the house's own columns, most used first. */
const discovered = [
  { key: "title", lots: 6921 },
  { key: "ref", lots: 6921 },
  { key: "品相", lots: 183 },
  { key: RESERVE, lots: 30 },
  { key: CONSIGNOR, lots: 30 },
];

describe("which fields the screen offers", () => {
  it("always offers the nine this system names, in their own order", () => {
    // Even at nought lots. A house can mark a field BEFORE the import that
    // fills it, and that direction is the only one that cannot leak: the
    // other order of events prints the reserve once and then hides it.
    const view = policyRows(policyFor(null), []);
    expect(view.core.map((row) => row.key)).toEqual([...CORE_FIELD_KEYS]);
    expect(view.core.every((row) => row.lots === 0)).toBe(true);
  });

  it("offers the house's own columns, which are only in the records", () => {
    // 保留價 is in no source file and never will be: the noun set belongs to
    // the customer and arrives at import. This is the whole reason the screen
    // cannot be a fixed list.
    const view = policyRows(policyFor(null), discovered);
    expect(view.house.map((row) => row.key)).toEqual(["品相", RESERVE, CONSIGNOR]);
    expect(view.house.map((row) => row.lots)).toEqual([183, 30, 30]);
  });

  it("names each field once, however many sources know about it", () => {
    // `title` is a core field AND a discovered one; the policy knows about
    // 保留價 as well. Two rows for one field is two controls whose last press
    // wins, which is the worst possible defect on this particular screen.
    const view = policyRows(policyFor({ [RESERVE]: "house", title: "internal" }), discovered);
    const keys = view.all.map((row) => row.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.filter((k) => k === "title")).toHaveLength(1);
    expect(keys.filter((k) => k === RESERVE)).toHaveLength(1);
  });

  it("still offers a marked field no lot carries any more", () => {
    // Otherwise it can be neither seen nor un-marked, and it goes on holding
    // a value back from every output for ever. The lot record avoids the same
    // trap by still listing an override on a field the record has lost.
    const view = policyRows(policyFor({ 舊欄位: "house" }), discovered);
    const orphan = view.house.find((row) => row.key === "舊欄位");
    expect(orphan?.level).toBe("house");
    expect(orphan?.lots).toBe(0);
    expect(orphan?.hint).toContain("no lot carries this");
  });

  it("never offers a carried key", () => {
    // `_`-prefixed keys never print at any audience, so a level on one is a
    // control with no effect — which is the one thing this screen must not
    // contain. They are refused whichever direction they arrive from.
    const view = policyRows(policyFor({ _row: "house" }), [{ key: "_source", lots: 12 }]);
    expect(view.all.map((row) => row.key)).not.toContain("_source");
    expect(view.all.map((row) => row.key)).not.toContain("_row");
  });

  it("reads each row's level through the same function the engine does", () => {
    const view = policyRows(policyFor({ [RESERVE]: "house", price: "internal" }), discovered);
    const level = (key: string) => view.all.find((row) => row.key === key)?.level;
    expect(level(RESERVE)).toBe("house");
    expect(level("price")).toBe("internal");
    // Everything else is public, because the house has said nothing about it.
    expect(level("title")).toBe("public");
    expect(view.marked).toBe(2);
  });

  it("counts nothing marked for a house that has said nothing", () => {
    expect(policyRows(policyFor(null), discovered).marked).toBe(0);
  });
});

describe("what pressing Save stores", () => {
  it("stores nothing at all when every field is left alone", () => {
    // THE CASE THE WHOLE SCREEN IS JUDGED BY. Every org in every database is
    // here today, and the default is that nothing changes.
    const rows = policyRows(policyFor(null), discovered);
    const stored = policyOf(rows.all.map((row) => [row.key, row.level] as const));
    expect(stored).toEqual({});
    expect(policyFor(stored)).toEqual(policyFor(null));
  });

  it("stores only what was actually decided", () => {
    const stored = policyOf([
      ["title", "public"],
      [RESERVE, "house"],
      [CONSIGNOR, "internal"],
      ["price", "public"],
    ]);
    expect(stored).toEqual({ [RESERVE]: "house", [CONSIGNOR]: "internal" });
  });

  it("returns a field to public by dropping its key, not by naming it", () => {
    // The map is written WHOLE (src/lib/data/org.ts), so an absent key is how
    // "stop holding this back" is said. There is no sentinel and there must
    // not be one — a stored "public" would be indistinguishable from a house
    // that had decided the field is public, which is not a thing this product
    // needs to record.
    const before = policyFor({ [RESERVE]: "house" });
    const after = policyOf([[RESERVE, "public"]]);
    expect(before[RESERVE]).toBe("house");
    expect(after).toEqual({});
    expect(RESERVE in after).toBe(false);
  });

  it("refuses a level it cannot read instead of guessing at one", () => {
    // The ASYMMETRY with `policyFor` is deliberate and it is worth stating.
    // The reader treats an unparseable level as `house`, because the value is
    // already in the column and may have been written by a later schema.
    // Here the value has just come off a select this screen rendered, so
    // anything else is a hand-made request — and storing `house` for it would
    // let a crafted form hide a field nobody chose.
    expect(policyOf([[RESERVE, "hosue"]])).toEqual({});
    expect(policyOf([[RESERVE, "consignor"]])).toEqual({});
    expect(policyOf([[RESERVE, ""]])).toEqual({});
    // And the reader's own rule is unchanged, which is what makes the pair
    // safe rather than merely different.
    expect(policyFor({ [RESERVE]: "hosue" })[RESERVE]).toBe("house");
  });

  it("refuses a key this screen would not have drawn", () => {
    expect(policyOf([["", "house"]])).toEqual({});
    expect(policyOf([["_carried", "house"]])).toEqual({});
    expect(policyOf([["x".repeat(MAX_KEY + 1), "house"]])).toEqual({});
    // And accepts one exactly at the bound, which is the same eighty every
    // other writer of a field key uses.
    expect(policyOf([["x".repeat(MAX_KEY), "house"]])).toEqual({
      ["x".repeat(MAX_KEY)]: "house",
    });
  });

  it("lets the last word about a key win", () => {
    // Which is what a FormData holding one name twice means, and what a field
    // named in the "not arrived yet" box that is also already a row means.
    expect(policyOf([[RESERVE, "internal"], [RESERVE, "house"]])).toEqual({
      [RESERVE]: "house",
    });
    expect(policyOf([[RESERVE, "house"], [RESERVE, "public"]])).toEqual({});
  });

  it("round-trips through the reader without changing anything", () => {
    // Two normalisers that disagree is a policy that means one thing when it
    // is saved and another when it is read, on the column that decides what
    // leaves the building.
    const stored = policyOf([
      [RESERVE, "house"],
      [CONSIGNOR, "internal"],
      ["price", "public"],
    ]);
    expect({ ...policyFor(stored) }).toEqual(stored);
  });

  it("stores a field no lot carries yet", () => {
    // The point of naming one by hand: the next import brings 保留價 and it is
    // held back from the first derivation rather than from the second.
    const stored = policyOf([["保留價", "house"]]);
    const view = policyRows(policyFor(stored), []);
    expect(view.all.find((row) => row.key === "保留價")?.level).toBe("house");
  });
});
