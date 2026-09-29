// Which tab of the lot record a field lands on.
//
// The interesting half of this is a GUESS about somebody else's spreadsheet —
// that a column called 保留價 is money and a column called 委託人 is not — and
// a guess that is not written down as cases is a guess nobody can argue with.
// So the cases are here, including the ones the rule deliberately declines.

import { describe, expect, it } from "vitest";

import { CORE_FIELDS } from "@/lib/import/fields";
import { isMoneyField, MONEY_HEADERS, partitionByMoney } from "@/lib/lot-record";

const row = (key: string): { key: string } => ({ key });

describe("what the record calls money", () => {
  it("always takes the core estimate, whatever a house called its column", () => {
    // `price` IS THE KEY AND 估價 IS ITS LABEL. Writing `estimate` here reads
    // perfectly, matches nothing, and leaves the Financial tab empty for every
    // house in the product — which is how the first version of this shipped in
    // a working tree until this test was written.
    expect(isMoneyField("price")).toBe(true);
    // The importer resolved 估價 / 底價 / Est. onto that key, so this holds for
    // every house at once and the tab is never empty.
    expect(CORE_FIELDS.some((f) => f.key === "price" && f.label.zh === "估價")).toBe(true);
  });

  it("takes the money columns a Hong Kong house actually imports", () => {
    for (const header of ["保留價", "底價", "成交價", "落槌價", "佣金", "買家佣金"]) {
      expect(isMoneyField(header), header).toBe(true);
    }
    for (const header of ["Reserve", "Hammer Price", "Buyer's Premium", "Sale price"]) {
      expect(isMoneyField(header), header).toBe(true);
    }
  });

  it("matches whole headers, so a column of prose stays on Details", () => {
    // 價 as a substring would have taken all three of these, and a column of
    // sentences would have arrived on a tab of numbers.
    expect(isMoneyField("評價")).toBe(false);
    expect(isMoneyField("定價方式")).toBe(false);
    expect(isMoneyField("價格說明")).toBe(false);
  });

  it("leaves the columns beside the money ones alone", () => {
    // 委託人 sits next to 保留價 in every consignment sheet and is a person.
    for (const header of ["委託人", "品名", "作者", "年代", "材質", "尺寸", "描述"]) {
      expect(isMoneyField(header), header).toBe(false);
    }
  });

  it("never takes a carried key, whatever it is called", () => {
    // `_`-prefixed keys are the predecessor's bookkeeping and never print
    // (src/lib/engine/derive.ts, `neverPrints`). Grouping one with the
    // estimate would put the field a specialist reads first beside values
    // that are not values at all.
    expect(isMoneyField("_估價")).toBe(false);
    expect(isMoneyField("_reserve")).toBe(false);
  });

  it("folds case, spacing and full-width punctuation like the importer does", () => {
    // Through `normaliseHeader`, and not a second normaliser: two that drift
    // is a bug that presents as "matching got worse".
    expect(isMoneyField(" Hammer  Price ")).toBe(true);
    expect(isMoneyField("ＲＥＳＥＲＶＥ")).toBe(true);
    expect(isMoneyField("reserve_price")).toBe(true);
  });

  it("holds no header that is already a core field's own label", () => {
    // Every core key but `estimate` reaches this list as a header string, and
    // one of them landing in it would move a field off Details for every
    // house in the product at once.
    const core = new Set(
      CORE_FIELDS.filter((f) => f.key !== "price").flatMap((f) => [
        f.label.zh,
        f.label.en.toLowerCase(),
      ]),
    );
    expect(MONEY_HEADERS.filter((h) => core.has(h))).toEqual([]);
  });
});

describe("splitting the record between the two tabs", () => {
  const rows = [
    row("ref"),
    row("title"),
    row("price"),
    row("保留價"),
    row("委託人"),
  ];

  it("puts every field on exactly one tab", () => {
    const { details, financial } = partitionByMoney(rows);
    // A field in both halves would be a field with two editors, and the
    // second save would show a value the first had already changed.
    expect([...details, ...financial]).toHaveLength(rows.length);
    expect(details.map((r) => r.key)).toEqual(["ref", "title", "委託人"]);
    expect(financial.map((r) => r.key)).toEqual(["price", "保留價"]);
  });

  it("keeps the record's order inside each half", () => {
    const { financial } = partitionByMoney([row("保留價"), row("price")]);
    // The record's order is the template's order and a specialist reads down
    // it; re-sorting either half would quietly re-sequence the form.
    expect(financial.map((r) => r.key)).toEqual(["保留價", "price"]);
  });

  it("returns two empty halves for an empty record rather than throwing", () => {
    expect(partitionByMoney([])).toEqual({ details: [], financial: [] });
  });
});
