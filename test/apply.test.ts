// Applying a cleared mapping — the step between the matching screen and the
// database, and the last point at which a person can still see what is about to
// happen.

import { describe, expect, it } from "vitest";

import { applyMapping, type Mapping } from "@/lib/import/apply";
import type { ParsedTable } from "@/lib/import/parse";

function table(headers: string[], rows: string[][], headerRow = 0): ParsedTable {
  return {
    kind: "table",
    headers,
    rows,
    source: {
      filename: "lots.csv",
      format: "csv",
      headerRow,
      skippedRows: [],
    },
  };
}

const SALE = table(
  ["編號", "品名", "估價", "倉位"],
  [
    ["P01", "秋山圖", "800,000–1,200,000 HKD", "A-12"],
    ["P02", "墨荷", "400,000–600,000 HKD", "B-04"],
  ],
);

const STANDARD: Mapping = [
  { kind: "core", field: "ref" },
  { kind: "core", field: "title" },
  { kind: "core", field: "price" },
  { kind: "custom", name: "倉位" },
];

describe("applying a mapping", () => {
  it("keeps values exactly as the file wrote them", () => {
    const { lots } = applyMapping(SALE, STANDARD);
    expect(lots).toHaveLength(2);
    // The two things the predecessor's corpus taught, asserted: a reference is
    // a string, and a price is whatever the house wrote — including a range.
    expect(lots[0]!.ref).toBe("P01");
    expect(lots[0]!.fields.price).toBe("800,000–1,200,000 HKD");
    expect(lots[0]!.fields.title).toBe("秋山圖");
  });

  it("keeps a column the customer cares about under their own name", () => {
    const { lots } = applyMapping(SALE, STANDARD);
    // 倉位 is a warehouse location — not a core field, and not ours to discard.
    expect(lots[0]!.fields["倉位"]).toBe("A-12");
  });

  it("drops skipped columns entirely", () => {
    const mapping: Mapping = [
      { kind: "core", field: "ref" },
      { kind: "skip" },
      { kind: "skip" },
      { kind: "skip" },
    ];
    const { lots } = applyMapping(SALE, mapping);
    expect(Object.keys(lots[0]!.fields)).toEqual(["ref"]);
  });

  it("records an empty cell as absent, not as an empty string", () => {
    const sparse = table(["編號", "品名"], [["P01", ""]]);
    const { lots } = applyMapping(sparse, [
      { kind: "core", field: "ref" },
      { kind: "core", field: "title" },
    ]);
    // "The client did not say" and "the client said nothing" must not become the
    // same thing downstream.
    expect("title" in lots[0]!.fields).toBe(false);
  });

  it("points at the row number a person can see in Excel", () => {
    // Two rows of title block above the header, so the first lot is file row 4.
    const withTitle = table(["編號"], [["P01"], ["P02"]], 2);
    const { lots } = applyMapping(withTitle, [{ kind: "core", field: "ref" }]);
    expect(lots[0]!.sourceRow).toBe(4);
    expect(lots[1]!.sourceRow).toBe(5);
  });
});

describe("what it warns about rather than refusing", () => {
  it("names duplicate references and the rows they are on", () => {
    const dupes = table(
      ["編號", "品名"],
      [["P04", "甲"], ["P05", "乙"], ["P04", "丙"]],
    );
    const { warnings, lots } = applyMapping(dupes, [
      { kind: "core", field: "ref" },
      { kind: "core", field: "title" },
    ]);
    // It still imports — the person holding the file knows whether two P04s are
    // two sales merged or a copy-paste error, and this code does not.
    expect(lots).toHaveLength(3);
    const dupe = warnings.find((w) => w.includes("P04"));
    expect(dupe).toBeDefined();
    expect(dupe).toContain("2");
    expect(dupe).toMatch(/rows 2, 4/);
  });

  it("says so when nothing is mapped to a reference", () => {
    const { warnings } = applyMapping(SALE, [
      { kind: "skip" },
      { kind: "core", field: "title" },
      { kind: "skip" },
      { kind: "skip" },
    ]);
    // Photographs are matched to lots by reference; without one, that becomes
    // manual work — which a person should learn now rather than later.
    expect(warnings.some((w) => /reference/i.test(w))).toBe(true);
  });

  it("catches two columns mapped to the same custom name", () => {
    const { warnings } = applyMapping(SALE, [
      { kind: "core", field: "ref" },
      { kind: "custom", name: "備註" },
      { kind: "custom", name: "備註" },
      { kind: "skip" },
    ]);
    // The screen stops this for core fields; a custom name is typed by a person
    // and two columns are easily called the same thing.
    expect(warnings.some((w) => w.includes("備註"))).toBe(true);
  });

  it("skips rows that are empty in every mapped column, and counts them", () => {
    const padded = table(
      ["編號", "品名"],
      [["P01", "秋山圖"], ["", ""], ["P02", "墨荷"]],
    );
    const { lots, skippedRows, warnings } = applyMapping(padded, [
      { kind: "core", field: "ref" },
      { kind: "core", field: "title" },
    ]);
    expect(lots).toHaveLength(2);
    expect(skippedRows).toBe(1);
    expect(warnings.some((w) => w.includes("1 row"))).toBe(true);
  });
});
