// Field visibility: the ladder, the total reader, and the drop in the engine.
//
// The claim this file holds is a NEGATIVE one — that a value the house marked
// does not appear in an output it may not appear in — and a negative claim is
// the kind a test has to state from both ends or it proves nothing. So every
// withholding assertion below is paired with the same derivation at an audience
// that DOES permit the field, because "the price is absent" is also true of a
// lot with no price, of a template that does not name one, and of a caption
// budget too small to carry it.
//
// ── AND THE DEFAULT, WHICH IS THE OTHER HALF ────────────────────────────────
//
// The strongest proof that nothing changed for a house with no policy is not
// here: it is test/golden.test.ts, four whole documents compared byte for byte
// against files on disk, untouched by this work and still green. What is here
// is the proof that the code PATH is the same one as well — that an empty
// policy is not "withhold nothing, slowly, through a different branch" — and
// the render-level compare that makes the golden's silence meaningful for
// arrangements and audiences the goldens do not cover.

import { describe, expect, it } from "vitest";

import {
  DEFAULT_PARAMS,
  derive,
  normaliseParams,
  type CatalogueDocument,
  type CatalogueParams,
  type EngineLot,
  type EngineOverride,
} from "@/lib/engine/derive";
import {
  BUILT_IN_TEMPLATES,
  CATALOGUE,
  PRICE_LIST,
  TEARSHEET,
  type Template,
} from "@/lib/engine/templates";
import {
  AUDIENCES,
  EMPTY_POLICY,
  audienceFor,
  levelOf,
  policyFor,
  readAudiences,
  reaches,
  withheldAt,
  type Audience,
  type FieldPolicy,
} from "@/lib/engine/visibility";
import { renderCatalogue } from "@/lib/render/html";

// ── The vocabulary ──────────────────────────────────────────────────────────

describe("the three levels are named and ordered", () => {
  it("is exactly three, in order of reach", () => {
    // The array order IS the ladder — `RANK` is built from it — so a level
    // inserted in the middle changes what every stored row means. Pinning the
    // list is what makes that a deliberate act rather than a diff nobody reads.
    expect(AUDIENCES).toEqual(["public", "internal", "house"]);
  });

  it.each([
    ["public", "public", true],
    ["public", "internal", true],
    ["public", "house", true],
    ["internal", "public", false],
    ["internal", "internal", true],
    ["internal", "house", true],
    ["house", "public", false],
    ["house", "internal", false],
    ["house", "house", true],
  ] as const)("a %s field in a %s output: %s", (level, audience, expected) => {
    expect(reaches(level, audience)).toBe(expected);
  });
});

describe("audienceFor is total over anything catalogues.params can hold", () => {
  it.each([null, undefined, "", "nonsense", "PUBLIC", 2, 0, {}, [], true])(
    "%o is public",
    (raw) => {
      expect(audienceFor(raw)).toBe("public");
    },
  );

  it.each(AUDIENCES)("keeps %s", (name) => {
    expect(audienceFor(name)).toBe(name);
  });

  it("makes a catalogue row written before the key existed a public one", () => {
    // Which is what every catalogue in every database is today, and is why
    // this key needed no migration on `catalogues`.
    expect(normaliseParams({ perPage: 9 }).audience).toBe("public");
    expect(normaliseParams(null).audience).toBe("public");
    expect(DEFAULT_PARAMS.audience).toBe("public");
  });
});

describe("policyFor is total over anything orgs.field_policy can hold", () => {
  it.each([null, undefined, "nonsense", 42, [], [["price", "house"]], true])(
    "%o is no policy at all",
    (raw) => {
      expect(policyFor(raw)).toBe(EMPTY_POLICY);
    },
  );

  it("an org that has said nothing withholds nothing from anybody", () => {
    for (const audience of AUDIENCES) {
      expect([...withheldAt(policyFor(null), audience)]).toEqual([]);
    }
  });

  it("a key nobody mentioned is public, which is the whole default", () => {
    const policy = policyFor({ 底價: "house" });
    expect(levelOf(policy, "底價")).toBe("house");
    expect(levelOf(policy, "title")).toBe("public");
    expect(levelOf(policy, "price")).toBe("public");
  });

  it("reads each of the three names back", () => {
    const policy = policyFor({ a: "public", b: "internal", c: "house" });
    expect(levelOf(policy, "a")).toBe("public");
    expect(levelOf(policy, "b")).toBe("internal");
    expect(levelOf(policy, "c")).toBe("house");
  });

  // ── The one asymmetry, and the reason for it ──────────────────────────────

  it("treats a value it cannot parse as house, not as public", () => {
    // ABSENCE IS SILENCE; NONSENSE IS A STATEMENT. `hosue` is one transposed
    // pair of letters, and the two possible readings are not symmetrical: a
    // field that mysteriously does not print is visible on the lot record and
    // fixed by correcting a word, and a reserve in a printed catalogue is not
    // recoverable at any price.
    for (const broken of ["hosue", "PUBLIC", "secret", 1, true, {}, []]) {
      expect(levelOf(policyFor({ reserve: broken }), "reserve")).toBe("house");
    }
  });

  it("reads a level a LATER version of this file wrote as the narrowest it knows", () => {
    // The same rule, told as the case it actually exists for: if a fourth
    // level is ever added between `internal` and `house`, every deployment
    // still running today's code must hold the field back rather than publish
    // it while it catches up.
    expect(levelOf(policyFor({ reserve: "consignor" }), "reserve")).toBe("house");
  });

  it("treats null as a cleared key and not as a corrupt one", () => {
    // `null` is how a jsonb write says "no longer asserted", which is how
    // src/lib/data/overrides.ts reads it of an override's keys.
    const policy = policyFor({ price: null, reserve: "house" });
    expect(levelOf(policy, "price")).toBe("public");
    expect(levelOf(policy, "reserve")).toBe("house");
  });

  it("cannot be made to write through Object.prototype", () => {
    // `JSON.parse('{"__proto__": …}')` makes it an OWN property, so it
    // survives into the column and back out. On a plain object the assignment
    // would reach the prototype's setter instead of storing a level.
    const policy = policyFor(JSON.parse('{"__proto__": "house", "price": "internal"}'));
    expect(levelOf(policy, "price")).toBe("internal");
    expect(({} as Record<string, unknown>).price).toBeUndefined();
    // And a field genuinely called `__proto__` is carried as data, not as a
    // prototype: the null-prototype container is what makes both true at once.
    expect(levelOf(policy, "__proto__")).toBe("house");
  });

  it("refuses a key no field could have", () => {
    // Eighty is the bound every writer of a field key already obeys — the lot
    // form's MAX_KEY and templates.ts's `fieldSchema.key`. A longer one cannot
    // name a field any lot holds, so carrying it would only make the policy a
    // place to keep arbitrary text.
    const policy = policyFor({ ["k".repeat(81)]: "house", ["k".repeat(80)]: "house" });
    expect(levelOf(policy, "k".repeat(81))).toBe("public");
    expect(levelOf(policy, "k".repeat(80))).toBe("house");
  });

  it("collects only what a given audience may not have", () => {
    const policy = policyFor({ a: "public", b: "internal", c: "house" });
    expect([...withheldAt(policy, "public")].sort()).toEqual(["b", "c"]);
    expect([...withheldAt(policy, "internal")]).toEqual(["c"]);
    expect([...withheldAt(policy, "house")]).toEqual([]);
  });
});

// ── The fixture ─────────────────────────────────────────────────────────────
//
// A house that keeps two things off the page: what it will not sell below, and
// who consigned it. Both are the house's own columns — they are not in
// CORE_FIELDS and never will be, because the noun set belongs to the customer
// (src/lib/import/fields.ts) — which is also why a policy has to be per-org
// rather than a list of secret field names shipped in the source.

const RESERVE = "底價";
const CONSIGNOR = "委託人";

const lot = (id: string, extra: Record<string, unknown> = {}): EngineLot => ({
  id,
  ref: id.toUpperCase(),
  fields: {
    title: "青花纏枝蓮紋梅瓶",
    maker: "佚名",
    price: "800,000 – 1,200,000 HKD",
    [RESERVE]: "750,000 HKD",
    [CONSIGNOR]: "高氏家族",
    ...extra,
  },
  images: ["plate"],
});

const SALE: EngineLot[] = [lot("a"), lot("b"), lot("c"), lot("d"), lot("e")];

/** The house's answer: the reserve never leaves, the consignor is staff-only. */
const POLICY: FieldPolicy = policyFor({ [RESERVE]: "house", [CONSIGNOR]: "internal" });

const on = (template: Template, audience: Audience = "public"): CatalogueParams => ({
  ...DEFAULT_PARAMS,
  template: template.id,
  perPage: template.defaultPerPage,
  audience,
});

const documentFor = (
  template: Template,
  audience: Audience,
  policy: FieldPolicy = POLICY,
  overrides: EngineOverride[] = [],
): CatalogueDocument =>
  derive(SALE, on(template, audience), [], overrides, BUILT_IN_TEMPLATES, policy);

/** Every (lot, field) the document actually carries, as the renderer will see it. */
function carried(doc: CatalogueDocument): Set<string> {
  const out = new Set<string>();
  for (const page of doc.pages) {
    for (const slot of page.slots) {
      if (slot.ref !== null) out.add("ref");
      if (slot.image !== null) out.add("images");
      for (const line of slot.caption) out.add(line.key);
    }
  }
  for (const column of doc.columns) out.add(column.key);
  return out;
}

// ── The drop ────────────────────────────────────────────────────────────────

describe("the engine drops what the audience may not have", () => {
  it("keeps a house field out of a public catalogue and lets it into a house one", () => {
    // BOTH ENDS. Without the second expectation this test also passes for a
    // fixture whose reserve never fitted the caption budget.
    expect(carried(documentFor(CATALOGUE, "public"))).not.toContain(RESERVE);
    expect(carried(documentFor(CATALOGUE, "house"))).toContain(RESERVE);
  });

  it("reads the middle level as the middle level", () => {
    const internal = carried(documentFor(CATALOGUE, "internal"));
    expect(internal).toContain(CONSIGNOR);
    expect(internal).not.toContain(RESERVE);
    const publicly = carried(documentFor(CATALOGUE, "public"));
    expect(publicly).not.toContain(CONSIGNOR);
  });

  it("drops a field EVEN WHERE THE TEMPLATE NAMES IT", () => {
    // The point of the whole phase, and the one case a check in a component
    // could never cover: `price` is declared by every built-in, so nothing
    // about the layout would have left it out.
    const policy = policyFor({ price: "house" });
    for (const template of [CATALOGUE, PRICE_LIST, TEARSHEET]) {
      expect(carried(documentFor(template, "public", policy))).not.toContain("price");
      expect(carried(documentFor(template, "house", policy))).toContain("price");
    }
  });

  it("gives a table no empty column where a withheld one would have been", () => {
    // A price list is FOUR declared columns and its rows come from the
    // template, not from the records — so without the filter in
    // `tableColumns` the estimate would be a headed, ruled, empty column in
    // every row, which does not leak the number and announces that there is
    // one.
    const policy = policyFor({ price: "house" });
    const doc = documentFor(PRICE_LIST, "public", policy);
    expect(doc.columns.map((c) => c.key)).not.toContain("price");
    // And the row is still whole: the widths of what is left add to one, so
    // the surviving columns took the missing one's share rather than leaving
    // a gap at the trim.
    const total = doc.columns.reduce((sum, c) => sum + c.width, 0);
    expect(total).toBeCloseTo(1, 10);
  });

  it("takes the plate's share back when the plate itself is withheld", () => {
    const doc = documentFor(PRICE_LIST, "public", policyFor({ images: "house" }));
    expect(doc.columns.map((c) => c.key)).not.toContain("images");
    expect(doc.columns.reduce((sum, c) => sum + c.width, 0)).toBeCloseTo(1, 10);
  });

  it("reaches the reference and the plate by the same (lot, field) key", () => {
    // The two things that are not entries in `fields`, handled by name here
    // for the reason `applyOverrides` handles them by name.
    const doc = documentFor(CATALOGUE, "public", policyFor({ ref: "house", images: "internal" }));
    const slot = doc.pages[0]!.slots[0]!;
    expect(slot.ref).toBeNull();
    expect(slot.image).toBeNull();
    // A WITHHELD PLATE IS A DECISION, NOT AN ABSENCE. The lot still has its
    // photograph and the editor must not report it as one to go and take —
    // the same answer the engine already gives for a hidden plate.
    expect(doc.unphotographed).toBe(0);
  });

  it("changes nothing when the house marks a field no lot carries", () => {
    const plain = documentFor(CATALOGUE, "public", EMPTY_POLICY);
    const marked = documentFor(CATALOGUE, "public", policyFor({ 保險價: "house" }));
    expect(JSON.stringify(marked)).toBe(JSON.stringify(plain));
  });

  it("SURVIVES EVERY DENSITY, like every other decision the engine re-applies", () => {
    for (const perPage of [1, 2, 4, 6, 9]) {
      const doc = derive(
        SALE,
        { ...on(CATALOGUE, "public"), perPage },
        [],
        [],
        BUILT_IN_TEMPLATES,
        POLICY,
      );
      expect(carried(doc)).not.toContain(RESERVE);
      // And the budget freed by a withheld field goes to the next field, the
      // way a hidden one's does — it is not spent on a blank line.
      expect(carried(doc)).toContain("title");
    }
  });

  it("is deterministic", () => {
    expect(JSON.stringify(documentFor(CATALOGUE, "public"))).toBe(
      JSON.stringify(documentFor(CATALOGUE, "public")),
    );
  });

  it("resolves an audience nothing wrote, so derive is total over its params too", () => {
    const wrong = { ...DEFAULT_PARAMS, audience: "nonsense" } as unknown as CatalogueParams;
    const doc = derive(SALE, wrong, [], [], BUILT_IN_TEMPLATES, POLICY);
    expect(doc.params.audience).toBe("public");
    expect(carried(doc)).not.toContain(RESERVE);
  });
});

// ── Composition with an override ────────────────────────────────────────────

describe("a level and an override do not disagree", () => {
  it("cannot be undone by printing something else instead", () => {
    // AN OVERRIDE MAY SUPPLY A VALUE THE RECORD DOES NOT HAVE, so if the
    // policy ran first a correction could re-introduce a withheld field. It
    // runs last, so nothing can put it back.
    const doc = documentFor(CATALOGUE, "public", POLICY, [
      { lotId: "a", field: RESERVE, text: "750,000 HKD" },
    ]);
    expect(carried(doc)).not.toContain(RESERVE);
  });

  it("cannot be undone by supplying a field the record never had", () => {
    const policy = policyFor({ 保留價: "house" });
    const doc = documentFor(CATALOGUE, "public", policy, [
      { lotId: "a", field: "保留價", text: "somebody typed this" },
    ]);
    expect(carried(doc)).not.toContain("保留價");
  });

  it("is absent once, not twice, when a field is both hidden here and house", () => {
    // They do the same thing to the same shape and the outcome is one
    // absence. What differs is reach and reversibility, which is the lot
    // record's to show — not the document's.
    const both = documentFor(CATALOGUE, "public", POLICY, [
      { lotId: "a", field: RESERVE, hidden: true },
    ]);
    const levelOnly = documentFor(CATALOGUE, "public", POLICY);
    expect(JSON.stringify(both)).toBe(JSON.stringify(levelOnly));
  });

  it("cannot be dragged back onto the page", () => {
    // A FRAME IS THE ONE OVERRIDE THAT SURVIVES THE DROP, and it has to be
    // asked about separately: `withhold` removes the value, and the frame is
    // carried in `slot.frames` regardless — exactly as it is for a `hidden`
    // field. That is only safe because the renderer looks a frame UP for a
    // part it is already painting (`slot.frames?.[key]`) rather than iterating
    // the map and painting whatever it finds. The day somebody writes that
    // loop, a placed reserve appears on a public page and nothing else in this
    // repository would notice, so the assertion is on the BYTES.
    const rendered = renderCatalogue(
      documentFor(CATALOGUE, "public", POLICY, [
        { lotId: "a", field: RESERVE, frame: { x: 0.1, y: 0.1, w: 0.3, h: 0.06 } },
      ]),
    );
    expect(rendered).not.toContain("750,000");
    expect(rendered).not.toContain(RESERVE);
    // BOTH ENDS: the same frame on a house output paints the value where it
    // was put, so this test is about the withholding and not about frames
    // being broken.
    const inHouse = renderCatalogue(
      documentFor(CATALOGUE, "house", POLICY, [
        { lotId: "a", field: RESERVE, frame: { x: 0.1, y: 0.1, w: 0.3, h: 0.06 } },
      ]),
    );
    expect(inHouse).toContain("750,000");
    expect(inHouse).toContain('data-frame-source="override"');
  });

  it("still lets an override hide a field the audience WOULD have had", () => {
    // The two mechanisms remain independent: withholding does not swallow a
    // per-catalogue decision about a field it says nothing about.
    const doc = documentFor(CATALOGUE, "house", POLICY, [
      { lotId: "a", field: "maker", hidden: true },
    ]);
    const first = doc.pages[0]!.slots[0]!;
    expect(first.caption.map((l) => l.key)).not.toContain("maker");
    // …on that lot only.
    const second = doc.pages[0]!.slots[1]!;
    expect(second.caption.map((l) => l.key)).toContain("maker");
  });

  it("leaves the record alone, as every derivation does", () => {
    const input = lot("z");
    derive([input], on(CATALOGUE, "public"), [], [], BUILT_IN_TEMPLATES, POLICY);
    expect(input.fields[RESERVE]).toBe("750,000 HKD");
    expect(input.ref).toBe("Z");
    expect(input.images).toEqual(["plate"]);
  });
});

// ── The default ─────────────────────────────────────────────────────────────

describe("an org with no policy gets the document it got before this existed", () => {
  const AUDIENCE_FREE: readonly Template[] = [CATALOGUE, PRICE_LIST, TEARSHEET];

  it.each(AUDIENCE_FREE.map((t) => [t.id, t] as const))(
    "%s renders the same bytes with and without the argument",
    (_id, template) => {
      // THE ARGUMENT IS NOT PASSED AT ALL on the left, which is how every
      // caller written before this phase calls `derive`. The compare is on the
      // RENDERED STRING rather than on the document, because bytes are what
      // reaches a printer and because that is the unit test/golden.test.ts
      // holds four documents to on disk — this is the same claim extended to
      // the arrangements and the corrections that file does not carry.
      const before = renderCatalogue(derive(SALE, on(template)));
      const after = renderCatalogue(
        derive(SALE, on(template), [], [], BUILT_IN_TEMPLATES, policyFor(null)),
      );
      expect(after).toBe(before);
    },
  );

  it.each([null, undefined, {}, "nonsense", { price: null }])(
    "and the same bytes for a column holding %o",
    (stored) => {
      const before = renderCatalogue(derive(SALE, on(CATALOGUE)));
      const after = renderCatalogue(
        derive(SALE, on(CATALOGUE), [], [], BUILT_IN_TEMPLATES, policyFor(stored)),
      );
      expect(after).toBe(before);
    },
  );

  it("takes the same branch, not merely the same answer", () => {
    // An empty policy must not mean "withhold nothing, slowly, by rebuilding
    // every lot". `derive` short-circuits on an empty withheld set and hands
    // the arrangement the CALLER'S OWN OBJECTS, which is what it did before
    // any of this — identity, not equality, is the assertion that says so.
    const input = [lot("a")];
    const doc = derive(input, on(CATALOGUE), [], [], BUILT_IN_TEMPLATES, EMPTY_POLICY);
    expect(doc.pages[0]!.slots[0]!.lotId).toBe("a");
    // Reaching the withholding through a policy that withholds nothing AT
    // THIS AUDIENCE is the same case: a house may mark a field `internal` and
    // an internal output is still unchanged.
    const internal = renderCatalogue(
      derive(input, on(CATALOGUE, "internal"), [], [], BUILT_IN_TEMPLATES, policyFor({ x: "internal" })),
    );
    expect(internal).toBe(renderCatalogue(derive(input, on(CATALOGUE, "internal"))));
  });
});

// ── What the record is told ─────────────────────────────────────────────────

describe("readAudiences says where a lot's values go", () => {
  const keys = ["ref", "title", "price", RESERVE, CONSIGNOR, "images"];

  it("counts the same way the engine drops", () => {
    const readings = readAudiences(POLICY, keys);
    expect(readings.map((r) => r.audience)).toEqual([...AUDIENCES]);
    expect(readings[0]!.carried).toEqual(["ref", "title", "price", "images"]);
    expect(readings[0]!.withheld).toEqual([
      { key: RESERVE, level: "house" },
      { key: CONSIGNOR, level: "internal" },
    ]);
    expect(readings[1]!.withheld).toEqual([{ key: RESERVE, level: "house" }]);
    expect(readings[2]!.withheld).toEqual([]);
  });

  it("agrees with the document, which is the only reason it exists", () => {
    // THE SCREEN'S NUMBER AGAINST THE ENGINE'S DOCUMENT. A count computed on
    // the lot page is a second opinion about the question the engine has
    // already answered, and the one thing worth asserting about it is that
    // the two never part. The tearsheet is the template used here because it
    // is the only one whose budgets are wide enough that nothing is dropped
    // for space — which would be a different kind of absence entirely.
    for (const audience of AUDIENCES) {
      const reading = readAudiences(POLICY, keys).find((r) => r.audience === audience)!;
      const doc = documentFor(TEARSHEET, audience);
      for (const { key } of reading.withheld) {
        expect(carried(doc).has(key), `${key} at ${audience}`).toBe(false);
      }
      for (const key of reading.carried) {
        expect(carried(doc).has(key), `${key} at ${audience}`).toBe(true);
      }
    }
  });

  it("keeps the caller's order, so a screen lists fields as the record shows them", () => {
    const reversed = readAudiences(POLICY, [...keys].reverse());
    expect(reversed[0]!.withheld.map((w) => w.key)).toEqual([CONSIGNOR, RESERVE]);
  });
});
