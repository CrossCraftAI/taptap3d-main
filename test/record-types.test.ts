// A house's own schema for its own records.
//
// Two halves are worth holding to account here, and they fail differently.
// The VALIDATION is a domain claim — what counts as a number in an auction
// house's spreadsheet, and what a select may be written as — and getting it
// wrong teaches a house that types are a nuisance. The READER is total by
// contract: a jsonb column a screen will one day write, read by a page that
// must open whatever is in it.

import { describe, expect, it } from "vitest";

import { CORE_FIELDS } from "@/lib/import/fields";
import {
  check,
  complaints,
  NO_RECORD_TYPES,
  PROPERTY_TYPES,
  recordTypeOf,
  recordTypesFrom,
  type PropertyDefinition,
  type RecordType,
} from "@/lib/record-types";

const prop = (over: Partial<PropertyDefinition> = {}): PropertyDefinition => ({
  key: "calibre",
  label: { zh: "機芯", en: "Calibre" },
  type: "text",
  ...over,
});

describe("what a property may be", () => {
  /**
   * THE OMISSION THAT MATTERS. A date in this trade is 清乾隆, 民國, "circa
   * 1860" — `CORE_FIELDS` says so at the field itself: "Period, dynasty or
   * year — text, not a calendar date". A `date` type would reject the correct
   * value for almost every Chinese antique in the first sale it met.
   */
  it("has no date type, because a date here is a dynasty", () => {
    expect(PROPERTY_TYPES).not.toContain("date");
    const date = CORE_FIELDS.find((f) => f.key === "date");
    expect(date?.hint).toContain("not a calendar date");
  });

  it("and the types it does have are named, not numbered", () => {
    // A person reading `select` in a jsonb column knows what it means; the
    // first thing that happens to a numeric scale is somebody inserting a
    // value in the middle and every stored row meaning something else.
    expect([...PROPERTY_TYPES]).toEqual(["text", "number", "select"]);
  });
});

describe("checking one value against one property", () => {
  it("lets anything through for text", () => {
    expect(check(prop(), "whatever they wrote").ok).toBe(true);
  });

  it("accepts empty, because absence is how every existing record looks", () => {
    // `lots.fields` drops a key whose value is blank, and every record
    // written before a type existed is missing most of what one now names.
    // Treating absence as a failure would light up a house's entire back
    // catalogue the moment they defined their first type.
    expect(check(prop({ type: "number" }), "").ok).toBe(true);
    expect(check(prop({ type: "select", options: ["A"] }), "   ").ok).toBe(true);
  });

  it("but not when the property is required", () => {
    const verdict = check(prop({ required: true }), "");
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toContain("機芯");
  });

  describe("a number, as a house actually writes one", () => {
    it("takes the measurements a specialist types", () => {
      // Demanding a bare numeral would reject the commonest real values and
      // teach a house that types are a nuisance.
      for (const value of ["42", "42.5", "1,200", "42 mm", "約 42", "114 × 146"]) {
        expect(check(prop({ type: "number" }), value).ok, value).toBe(true);
      }
    });

    it("and catches the one mistake worth catching", () => {
      const verdict = check(prop({ type: "number" }), "see condition report");
      expect(verdict.ok).toBe(false);
    });
  });

  describe("a select, which is the half that does the work", () => {
    const grade = prop({
      key: "品相",
      label: { zh: "品相", en: "Condition" },
      type: "select",
      options: ["A", "B", "C"],
    });

    it("accepts an option", () => {
      expect(check(grade, "B").ok).toBe(true);
    });

    it("accepts it however a person cased or spaced it", () => {
      // The same `normaliseHeader` the importer matches with, not a second
      // normaliser: two that drift is a bug presenting as "matching got
      // worse". Full-width characters are what a Chinese keyboard produces.
      const spaced = prop({ ...grade, options: ["Grade A", "Grade B"] });
      for (const value of ["grade a", "GRADE A", "Grade  A", "Ｇｒａｄｅ Ａ"]) {
        expect(check(spaced, value).ok, value).toBe(true);
      }
    });

    it("refuses one that is not, and names the set", () => {
      const verdict = check(grade, "D");
      expect(verdict.ok).toBe(false);
      if (!verdict.ok) {
        expect(verdict.reason).toContain("A");
        expect(verdict.reason).toContain("C");
      }
    });

    it("constrains nothing while the definition is half-finished", () => {
      // Refusing every value because the options are not filled in yet would
      // be the product punishing somebody mid-sentence.
      expect(check(prop({ type: "select", options: [] }), "anything").ok).toBe(true);
      expect(check(prop({ type: "select" }), "anything").ok).toBe(true);
    });
  });
});

describe("a lot against its type", () => {
  const watch: RecordType = {
    id: "watch",
    name: { zh: "腕錶", en: "Watch" },
    properties: [
      prop({ key: "機芯", label: { zh: "機芯", en: "Calibre" }, required: true }),
      prop({ key: "直徑", label: { zh: "直徑", en: "Diameter" }, type: "number" }),
      prop({
        key: "品相",
        label: { zh: "品相", en: "Condition" },
        type: "select",
        options: ["A", "B", "C"],
      }),
    ],
  };

  it("says nothing about a lot that satisfies it", () => {
    expect(complaints(watch, { 機芯: "Cal. 324", 直徑: "40 mm", 品相: "A" })).toEqual([]);
  });

  it("names every complaint rather than the first", () => {
    // A save that reported one problem at a time would be four round trips
    // for a record somebody is typing in one sitting.
    const out = complaints(watch, { 直徑: "see report", 品相: "D" });
    expect(out.map((c) => c.key).sort()).toEqual(["品相", "直徑", "機芯"].sort());
  });

  it("and counts a field that is not a string as absent", () => {
    // `lots.fields` is open jsonb and a migration wrote objects into it —
    // `{zh, en}` titles are the live example. A type over one of those must
    // not crash; it reports the field as missing, which it is as far as a
    // typed rule is concerned.
    expect(complaints(watch, { 機芯: { zh: "x" } })).toHaveLength(1);
  });
});

describe("reading whatever the column holds", () => {
  it("is empty for a house that has defined nothing, which is every house", () => {
    expect(recordTypesFrom(null)).toEqual(NO_RECORD_TYPES);
    expect(recordTypesFrom(undefined)).toEqual(NO_RECORD_TYPES);
    expect(recordTypesFrom("nonsense")).toEqual(NO_RECORD_TYPES);
    expect(recordTypesFrom([])).toEqual(NO_RECORD_TYPES);
  });

  it("reads a definition a screen would write", () => {
    const types = recordTypesFrom({
      watch: {
        name: { zh: "腕錶", en: "Watch" },
        properties: [
          { key: "機芯", label: { zh: "機芯", en: "Calibre" }, type: "text", required: true },
          { key: "品相", type: "select", options: ["A", "B"] },
        ],
      },
    });
    expect(Object.keys(types)).toEqual(["watch"]);
    expect(types.watch!.properties).toHaveLength(2);
    expect(types.watch!.properties[0]!.required).toBe(true);
    // A property with no label is labelled by its own key, which is the
    // customer's column name and the only honest answer.
    expect(types.watch!.properties[1]!.label.zh).toBe("品相");
  });

  it("drops what it cannot read rather than failing", () => {
    // The column is jsonb a screen will one day write, read by a page that
    // must open whatever is in it — `templateFor` and `faceFor`'s rule.
    const types = recordTypesFrom({
      ok: { name: { zh: "好", en: "Fine" }, properties: [{ key: "a" }] },
      noName: { properties: [{ key: "a" }] },
      notAnObject: 7,
      badProps: { name: { zh: "乙", en: "B" }, properties: "nope" },
    });
    expect(Object.keys(types).sort()).toEqual(["badProps", "ok"]);
    expect(types.badProps!.properties).toEqual([]);
    // An unknown type falls back to text rather than dropping the property:
    // the column still exists and a person still edits it.
    expect(recordTypesFrom({
      x: { name: { zh: "甲", en: "A" }, properties: [{ key: "k", type: "colour" }] },
    }).x!.properties[0]!.type).toBe("text");
  });

  it("never types a carried key", () => {
    // `_`-prefixed keys never print (derive.ts, `neverPrints`), so a rule
    // about one is a rule about a value nobody can see.
    const types = recordTypesFrom({
      x: { name: { zh: "甲", en: "A" }, properties: [{ key: "_source" }, { key: "real" }] },
    });
    expect(types.x!.properties.map((p) => p.key)).toEqual(["real"]);
  });

  it("keeps one definition per column, not the last one written", () => {
    const types = recordTypesFrom({
      x: {
        name: { zh: "甲", en: "A" },
        properties: [
          { key: "k", type: "select", options: ["A"] },
          { key: "k", type: "number" },
        ],
      },
    });
    expect(types.x!.properties).toHaveLength(1);
    expect(types.x!.properties[0]!.type).toBe("select");
  });

  it("and a lot with no type has none, which is every lot today", () => {
    const types = recordTypesFrom({ x: { name: { zh: "甲", en: "A" }, properties: [] } });
    expect(recordTypeOf(types, null)).toBeNull();
    expect(recordTypeOf(types, "gone")).toBeNull();
    expect(recordTypeOf(types, "x")?.id).toBe("x");
  });
});
