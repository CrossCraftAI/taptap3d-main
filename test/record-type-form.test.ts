// A house's record types, through a flat HTML form and back.
//
// The encoding is the whole of the risk here: a nested thing going through a
// flat form and coming back, with two halves that have to agree exactly. The
// round trip is the assertion that matters, and the id is the value that must
// never move — `lots.record_type` points at it, so a rename that re-slugged
// would silently untype every lot of that kind.

import { describe, expect, it } from "vitest";

import {
  joinOptions,
  rowsOf,
  slugFor,
  splitOptions,
  typesFromForm,
  type TypeRow,
} from "@/lib/record-type-form";
import { recordTypesFrom, type RecordTypes } from "@/lib/record-types";

/** The form a browser would send for these rows. */
function post(rows: TypeRow[]): [string, string][] {
  const out: [string, string][] = [];
  rows.forEach((row, i) => {
    out.push([`type:${i}:id`, row.id], [`type:${i}:zh`, row.zh], [`type:${i}:en`, row.en]);
    row.properties.forEach((p, j) => {
      out.push(
        [`prop:${i}:${j}:key`, p.key],
        [`prop:${i}:${j}:zh`, p.zh],
        [`prop:${i}:${j}:en`, p.en],
        [`prop:${i}:${j}:kind`, p.type],
        [`prop:${i}:${j}:options`, p.options],
      );
      // An unchecked box sends nothing at all, which is how `false` arrives.
      if (p.required) out.push([`prop:${i}:${j}:required`, "on"]);
    });
  });
  return out;
}

const WATCH: RecordTypes = recordTypesFrom({
  watch: {
    name: { zh: "腕錶", en: "Watch" },
    properties: [
      { key: "機芯", label: { zh: "機芯", en: "Calibre" }, type: "text", required: true },
      { key: "品相", label: { zh: "品相", en: "Condition" }, type: "select", options: ["A", "B"] },
    ],
  },
});

describe("a select's options, as a person types them", () => {
  it("takes the Chinese enumeration comma and the Latin one alike", () => {
    // A house will use both in the same afternoon; refusing one would be the
    // product telling somebody their keyboard is wrong.
    expect(splitOptions("A、B、C")).toEqual(["A", "B", "C"]);
    expect(splitOptions("A, B, C")).toEqual(["A", "B", "C"]);
    expect(splitOptions("A\nB")).toEqual(["A", "B"]);
  });

  it("drops the blanks and the repeats somebody typed", () => {
    // A select that offers A twice is a control that looks broken.
    expect(splitOptions("A、、B、A、  ")).toEqual(["A", "B"]);
  });

  it("round-trips through the box it is shown in", () => {
    expect(splitOptions(joinOptions(["甲", "乙"]))).toEqual(["甲", "乙"]);
  });
});

describe("an id for a newly named type", () => {
  it("is made from the English name", () => {
    expect(slugFor("Wrist Watch", new Set())).toBe("wrist-watch");
  });

  it("never collides with one already taken", () => {
    expect(slugFor("Watch", new Set(["watch"]))).toBe("watch-2");
    expect(slugFor("Watch", new Set(["watch", "watch-2"]))).toBe("watch-3");
  });

  it("and a name with no Latin letters still gets one", () => {
    // A house naming its types 腕錶 and 瓷器 would otherwise get two empty
    // slugs, and the second would overwrite the first.
    const taken = new Set<string>();
    const a = slugFor("腕錶", taken);
    taken.add(a);
    const b = slugFor("瓷器", taken);
    expect(a).toBe("type");
    expect(b).toBe("type-2");
  });
});

describe("the round trip", () => {
  it("brings back exactly what was stored", () => {
    // The two halves have to agree, and the way they stop agreeing is that
    // one of them lives somewhere nobody tests.
    expect(typesFromForm(post(rowsOf(WATCH)))).toEqual(WATCH);
  });

  /**
   * THE VALUE THAT MUST NEVER MOVE. `lots.record_type` stores the id, so a
   * house renaming 腕錶 to "Wristwatches" must keep `watch` — re-slugging on
   * rename would silently untype every lot of that kind, with nothing on any
   * screen to say it had happened.
   */
  it("keeps a type's id when the house renames it", () => {
    const rows = rowsOf(WATCH);
    rows[0]!.zh = "手錶";
    rows[0]!.en = "Wristwatches";
    const back = typesFromForm(post(rows));
    expect(Object.keys(back)).toEqual(["watch"]);
    expect(back.watch!.name).toEqual({ zh: "手錶", en: "Wristwatches" });
  });

  it("gives a newly added type an id of its own", () => {
    const rows = [...rowsOf(WATCH), { id: "", zh: "瓷器", en: "Ceramics", properties: [] }];
    const back = typesFromForm(post(rows));
    expect(Object.keys(back).sort()).toEqual(["ceramics", "watch"]);
  });
});

describe("what the form drops rather than refusing over", () => {
  it("an empty row somebody added and did not fill in", () => {
    // Which is what an "add another" button produces every single time. A
    // screen that refused to save eleven good types over one blank row at
    // the bottom would be unusable.
    const rows = [...rowsOf(WATCH), { id: "", zh: "", en: "", properties: [] }];
    expect(Object.keys(typesFromForm(post(rows)))).toEqual(["watch"]);
  });

  it("a property with no column name", () => {
    const rows = rowsOf(WATCH);
    rows[0]!.properties.push({ key: "", zh: "", en: "", type: "text", options: "", required: false });
    expect(typesFromForm(post(rows)).watch!.properties).toHaveLength(2);
  });

  it("a carried key, which never prints and so cannot be typed", () => {
    const rows = rowsOf(WATCH);
    rows[0]!.properties.push({
      key: "_source", zh: "", en: "", type: "text", options: "", required: false,
    });
    expect(typesFromForm(post(rows)).watch!.properties.map((p) => p.key)).toEqual(["機芯", "品相"]);
  });

  it("and a column named twice in one type", () => {
    const rows = rowsOf(WATCH);
    rows[0]!.properties.push({
      key: "機芯", zh: "x", en: "x", type: "number", options: "", required: false,
    });
    const props = typesFromForm(post(rows)).watch!.properties;
    expect(props).toHaveLength(2);
    // The FIRST wins, which is the same resolution `recordTypesFrom` makes,
    // so the two readers cannot disagree about what a column is.
    expect(props[0]!.type).toBe("text");
  });
});

describe("the fields the form does not literally send", () => {
  it("reads an absent checkbox as not required", () => {
    const rows = rowsOf(WATCH);
    rows[0]!.properties[0]!.required = false;
    expect(typesFromForm(post(rows)).watch!.properties[0]!.required).toBeUndefined();
  });

  it("keeps options only for a select", () => {
    // A number with options is somebody who changed the type and left the box
    // filled in; storing them would make the next reader wonder.
    const rows = rowsOf(WATCH);
    rows[0]!.properties[1]!.type = "number";
    expect(typesFromForm(post(rows)).watch!.properties[1]!.options).toBeUndefined();
  });

  it("falls back to text for a type it does not know", () => {
    const back = typesFromForm([
      ["type:0:id", "x"], ["type:0:zh", "甲"], ["type:0:en", "A"],
      ["prop:0:0:key", "k"], ["prop:0:0:kind", "colour"],
    ]);
    expect(back.x!.properties[0]!.type).toBe("text");
  });

  it("and ignores a field name that is not an index", () => {
    // The names carry integers and nothing else; the customer's strings are
    // values. Anything else arriving is not from this form.
    const back = typesFromForm([
      ["type:0:zh", "甲"], ["type:0:en", "A"],
      ["type:nonsense:zh", "乙"],
      ["prop:0:x:key", "k"],
      ["unrelated", "v"],
    ]);
    expect(Object.keys(back)).toHaveLength(1);
    expect(Object.values(back)[0]!.properties).toEqual([]);
  });

  it("and labels a property by its own column name when nobody labelled it", () => {
    const back = typesFromForm([
      ["type:0:id", "x"], ["type:0:zh", "甲"], ["type:0:en", "A"],
      ["prop:0:0:key", "保留價"], ["prop:0:0:kind", "text"],
    ]);
    // The customer's column name is the only honest answer.
    expect(back.x!.properties[0]!.label).toEqual({ zh: "保留價", en: "保留價" });
  });
});
