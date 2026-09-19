import { describe, expect, it } from "vitest";

import {
  DEFAULT_PARAMS,
  asText,
  derive,
  normaliseParams,
  type EngineLot,
} from "@/lib/engine/derive";
import { PREVIEW_CSP, renderCatalogue } from "@/lib/render/html";

function lot(id: string, overrides: Partial<EngineLot> = {}): EngineLot {
  return {
    id,
    ref: id.toUpperCase(),
    fields: { title: `Lot ${id}` },
    images: [],
    ...overrides,
  };
}

const lots = (count: number): EngineLot[] =>
  Array.from({ length: count }, (_, i) => lot(`p${i + 1}`));

describe("normaliseParams", () => {
  it("falls back to the default density rather than accepting an arbitrary one", () => {
    // 7 does not divide a page. Accepting it would produce a grid with a hole in
    // it that nobody chose.
    expect(normaliseParams({ perPage: 7 }).perPage).toBe(DEFAULT_PARAMS.perPage);
    expect(normaliseParams({ perPage: 9 }).perPage).toBe(9);
  });

  it("survives a params column written by an older version", () => {
    // catalogues.params is jsonb and nothing constrains its shape, so the engine
    // has to be total over whatever is in there.
    expect(() => normaliseParams(null)).not.toThrow();
    expect(() => normaliseParams("nonsense")).not.toThrow();
    expect(normaliseParams(undefined)).toEqual(DEFAULT_PARAMS);
  });

  it("keeps fit and placement distinguishable", () => {
    expect(normaliseParams({ fit: "width" }).fit).toBe("width");
    expect(normaliseParams({ fit: "nonsense" }).fit).toBe("page");
    expect(normaliseParams({ imagePlacement: "beside" }).imagePlacement).toBe("beside");
  });
});

describe("derive", () => {
  it("paginates by density and places every lot exactly once", () => {
    for (const perPage of [1, 2, 4, 6, 9]) {
      const doc = derive(lots(10), { ...DEFAULT_PARAMS, perPage });
      expect(doc.pages.length).toBe(Math.ceil(10 / perPage));
      const placed = doc.pages.flatMap((p) => p.slots.map((s) => s.lotId));
      expect(placed).toHaveLength(10);
      expect(new Set(placed).size).toBe(10);
    }
  });

  it("keeps file order — the house sequenced the sheet deliberately", () => {
    const doc = derive(lots(6), { ...DEFAULT_PARAMS, perPage: 4 });
    expect(doc.pages.flatMap((p) => p.slots.map((s) => s.lotId))).toEqual([
      "p1", "p2", "p3", "p4", "p5", "p6",
    ]);
  });

  it("does not split a pin across a page break", () => {
    // p3 and p4 are pinned together at 3-up, so p3 would normally end page one.
    const doc = derive(
      lots(6),
      { ...DEFAULT_PARAMS, perPage: 4 },
      [{ keepsTogether: true, lotIds: ["p4", "p5"] }],
    );
    const pageOf = (id: string): number =>
      doc.pages.findIndex((p) => p.slots.some((s) => s.lotId === id));
    expect(pageOf("p4")).toBe(pageOf("p5"));
  });

  it("leaves a gap rather than back-filling it", () => {
    // Back-filling would reorder the house's own sequence to close the hole,
    // which is a worse outcome than a short page.
    const doc = derive(
      lots(6),
      { ...DEFAULT_PARAMS, perPage: 4 },
      [{ keepsTogether: true, lotIds: ["p4", "p5"] }],
    );
    expect(doc.pages[0]!.slots.map((s) => s.lotId)).toEqual(["p1", "p2", "p3"]);
  });

  it("places a pin larger than a page rather than refusing", () => {
    // Refusing mid-pitch is worse than a group that spans a spread.
    const doc = derive(
      lots(5),
      { ...DEFAULT_PARAMS, perPage: 2 },
      [{ keepsTogether: true, lotIds: ["p1", "p2", "p3", "p4", "p5"] }],
    );
    expect(doc.pages.flatMap((p) => p.slots)).toHaveLength(5);
  });

  it("counts the lots with no photograph rather than hiding them", () => {
    const doc = derive(
      [lot("a"), lot("b", { images: ["deadbeef"] })],
      DEFAULT_PARAMS,
    );
    expect(doc.unphotographed).toBe(1);
    expect(doc.pages[0]!.slots[1]!.image).toBe("deadbeef");
  });

  it("reads images[0] as the plate and ignores the rest", () => {
    const doc = derive([lot("a", { images: ["one", "two", "three"] })], DEFAULT_PARAMS);
    expect(doc.pages[0]!.slots[0]!.image).toBe("one");
  });

  it("drops the reference from the slot when the house does not print one", () => {
    const doc = derive(lots(1), { ...DEFAULT_PARAMS, showRef: false });
    expect(doc.pages[0]!.slots[0]!.ref).toBeNull();
  });

  it("prints custom fields under the customer's own header", () => {
    // The field set is theirs. A column they asked to keep and then never see
    // again is a column discarded with extra steps.
    const doc = derive(
      [lot("a", { fields: { title: "Vase", 品相: "A-" } })],
      DEFAULT_PARAMS,
    );
    const keys = doc.pages[0]!.slots[0]!.caption.map((l) => l.key);
    expect(keys).toContain("品相");
    // Core fields lead; the customer's own follow.
    expect(keys.indexOf("title")).toBeLessThan(keys.indexOf("品相"));
  });

  it("budgets the caption by density, core fields first", () => {
    // The migration brought the house's own columns across, and a caption prints
    // every field it does not recognise — so a four-up page grew captions of
    // eleven entries into a box that holds six and printed the overflow cut
    // mid-sentence. Core fields win the budget; the customer's own columns take
    // what is left; nothing is deleted from the lot.
    const busy = lot("a", {
      fields: {
        title: "青花瓶",
        maker: "張大千",
        date: "1965",
        material: "設色",
        dimensions: "60 × 95 cm",
        price: "800,000 – 1,200,000 HKD",
        description: "長篇說明",
        notes: "n",
        sealMarks: "s",
        substrate: "紙本",
        provenance: "p",
      },
    });

    const dense = derive([busy], { ...DEFAULT_PARAMS, perPage: 9 });
    const sparse = derive([busy], { ...DEFAULT_PARAMS, perPage: 1 });
    const denseKeys = dense.pages[0]!.slots[0]!.caption.map((l) => l.key);
    const sparseKeys = sparse.pages[0]!.slots[0]!.caption.map((l) => l.key);

    expect(denseKeys.length).toBeLessThan(sparseKeys.length);
    // Whatever survives at nine-up is catalogue content, never a stray column.
    // A dense page carries the work, who made it, when, and what it is expected
    // to fetch. It gives up the description first — and never the estimate.
    expect(denseKeys).toEqual(["title", "maker", "date", "price"]);
    expect(denseKeys).not.toContain("description");
    // With room, the house's own columns print under their own names.
    expect(sparseKeys).toContain("provenance");
  });

  it("never drops a core field to make room for a custom one", () => {
    const doc = derive(
      [
        lot("a", {
          fields: { zzz: "custom", title: "青花瓶", price: "1,000 HKD" },
        }),
      ],
      { ...DEFAULT_PARAMS, perPage: 9 },
    );
    const keys = doc.pages[0]!.slots[0]!.caption.map((l) => l.key);
    expect(keys.indexOf("title")).toBeLessThan(keys.indexOf("zzz"));
    expect(keys).toContain("price");
  });

  it("caps a long caption line by density, whatever field it came from", () => {
    // The clamp that used to do this was CSS keyed to the description class, and
    // it never fired once on real data: the predecessor's long prose arrives
    // under a column the house calls `notes`, which prints as a custom field.
    // Any field can be long, so the bound is field-agnostic.
    const prose = "此作為趙無極晚期重要油畫，展現其成熟的抽象風格。".repeat(12);
    const busy = lot("a", { fields: { title: "青花瓶", notes: prose } });

    const dense = derive([busy], { ...DEFAULT_PARAMS, perPage: 9 });
    const sparse = derive([busy], { ...DEFAULT_PARAMS, perPage: 1 });
    const lineAt = (doc: ReturnType<typeof derive>, key: string): string =>
      doc.pages[0]!.slots[0]!.caption.find((l) => l.key === key)?.value ?? "";

    expect(lineAt(dense, "notes").length).toBeLessThan(
      lineAt(sparse, "notes").length,
    );
    // Shortened, and it SAYS so.
    expect(lineAt(dense, "notes").endsWith("…")).toBe(true);
    expect(lineAt(dense, "notes").length).toBeLessThan(prose.length);
    // The lot itself is untouched — this is a derivation, not an edit.
    expect(busy.fields.notes).toBe(prose);
  });

  it("leaves a caption that already fits exactly alone", () => {
    const doc = derive(
      [lot("a", { fields: { title: "青花瓶", maker: "張大千" } })],
      DEFAULT_PARAMS,
    );
    const values = doc.pages[0]!.slots[0]!.caption.map((l) => l.value);
    expect(values).toEqual(["青花瓶", "張大千"]);
    expect(values.some((v) => v.endsWith("…"))).toBe(false);
  });

  it("is deterministic — the same inputs give the same document", () => {
    const input = lots(7);
    expect(JSON.stringify(derive(input, DEFAULT_PARAMS))).toBe(
      JSON.stringify(derive(input, DEFAULT_PARAMS)),
    );
  });
});

describe("overrides — this catalogue's judgement, re-applied on every derivation", () => {
  const record = (): EngineLot =>
    lot("a", {
      fields: { title: "青花瓶", maker: "張大千", price: "1,000 HKD" },
      images: ["plate-hash"],
    });
  const captionKeys = (doc: ReturnType<typeof derive>): string[] =>
    doc.pages[0]!.slots[0]!.caption.map((l) => l.key);
  const lineValue = (doc: ReturnType<typeof derive>, key: string): string | undefined =>
    doc.pages[0]!.slots[0]!.caption.find((l) => l.key === key)?.value;

  it("hides a field in this catalogue and leaves the record alone", () => {
    const input = record();
    const doc = derive([input], DEFAULT_PARAMS, [], [
      { lotId: "a", field: "maker", hidden: true },
    ]);
    expect(captionKeys(doc)).not.toContain("maker");
    expect(captionKeys(doc)).toContain("title");
    // A correction is a VALUE the engine applies, never a write into the lot.
    expect(input.fields.maker).toBe("張大千");
  });

  it("prints a different value in this catalogue only", () => {
    const input = record();
    const doc = derive([input], DEFAULT_PARAMS, [], [
      { lotId: "a", field: "title", text: "青花纏枝蓮紋梅瓶" },
    ]);
    expect(lineValue(doc, "title")).toBe("青花纏枝蓮紋梅瓶");
    expect(input.fields.title).toBe("青花瓶");
  });

  it("supplies a value the record does not have", () => {
    // "Print a maker in this catalogue" for a lot whose record has none is the
    // same gesture as replacing one, and it must not need the record edited.
    const doc = derive([lot("a", { fields: { title: "青花瓶" } })], DEFAULT_PARAMS, [], [
      { lotId: "a", field: "maker", text: "佚名" },
    ]);
    expect(lineValue(doc, "maker")).toBe("佚名");
  });

  it("lets hidden win over text", () => {
    const doc = derive([record()], DEFAULT_PARAMS, [], [
      { lotId: "a", field: "maker", hidden: true, text: "somebody" },
    ]);
    expect(captionKeys(doc)).not.toContain("maker");
  });

  it("reaches the reference and the plate by the same (lot, field) key", () => {
    const doc = derive([record()], DEFAULT_PARAMS, [], [
      { lotId: "a", field: "ref", hidden: true },
      { lotId: "a", field: "images", hidden: true },
    ]);
    const slot = doc.pages[0]!.slots[0]!;
    expect(slot.ref).toBeNull();
    expect(slot.image).toBeNull();
    // Hidden is a decision, not an absence: the lot still HAS a photograph.
    expect(doc.unphotographed).toBe(0);
  });

  it("retypes the reference but never the plate", () => {
    const doc = derive([record()], DEFAULT_PARAMS, [], [
      { lotId: "a", field: "ref", text: "P04a" },
      { lotId: "a", field: "images", text: "not-a-hash" },
    ]);
    expect(doc.pages[0]!.slots[0]!.ref).toBe("P04a");
    expect(doc.pages[0]!.slots[0]!.image).toBe("plate-hash");
  });

  it("ignores an override for a lot that is not in the document", () => {
    const plain = derive([record()], DEFAULT_PARAMS);
    const withStray = derive([record()], DEFAULT_PARAMS, [], [
      { lotId: "nobody", field: "title", hidden: true },
    ]);
    expect(JSON.stringify(withStray)).toBe(JSON.stringify(plain));
  });

  it("does not charge a hidden field against the caption budget", () => {
    // Nine-up carries four lines. With the maker hidden, the fourth line goes
    // to the next field by priority instead of being left blank.
    const busy = lot("a", {
      fields: {
        title: "t",
        maker: "m",
        date: "d",
        material: "mat",
        dimensions: "dim",
        price: "p",
      },
    });
    const doc = derive([busy], { ...DEFAULT_PARAMS, perPage: 9 }, [], [
      { lotId: "a", field: "maker", hidden: true },
    ]);
    expect(captionKeys(doc)).toEqual(["title", "date", "dimensions", "price"]);
  });

  it("SURVIVES EVERY DENSITY — the thesis of the architecture", () => {
    // The same lot is the fifth slot of page one at nine-up and the first slot
    // of page three at two-up. Nothing about these overrides says where the lot
    // is, so nothing about them is destroyed when it moves.
    const input = [lots(5), record(), lots(4).map((l) => lot(`q${l.id}`))].flat();
    const overrides = [
      { lotId: "a", field: "maker", hidden: true },
      { lotId: "a", field: "price", text: "估價待詢" },
    ];
    for (const perPage of [1, 2, 4, 6, 9]) {
      const doc = derive(input, { ...DEFAULT_PARAMS, perPage }, [], overrides);
      const slot = doc.pages.flatMap((p) => p.slots).find((s) => s.lotId === "a")!;
      expect(slot, `lot a is placed at ${perPage}-up`).toBeDefined();
      const keys = slot.caption.map((l) => l.key);
      expect(keys, `maker hidden at ${perPage}-up`).not.toContain("maker");
      expect(
        slot.caption.find((l) => l.key === "price")?.value,
        `price overridden at ${perPage}-up`,
      ).toBe("估價待詢");
    }
  });
});

describe("pins — keyed by members, so a density change cannot orphan them", () => {
  const pageOf = (doc: ReturnType<typeof derive>, id: string): number =>
    doc.pages.find((p) => p.slots.some((s) => s.lotId === id))!.number;

  it("keeps its members on one page at every density they fit", () => {
    const input = lots(10);
    const pins = [{ keepsTogether: true, lotIds: ["p4", "p5"] }];
    const landed: number[] = [];
    for (const perPage of [2, 4, 6, 9]) {
      const doc = derive(input, { ...DEFAULT_PARAMS, perPage }, pins);
      expect(pageOf(doc, "p4"), `together at ${perPage}-up`).toBe(pageOf(doc, "p5"));
      landed.push(pageOf(doc, "p4"));
    }
    // And the page they share is DIFFERENT at different densities — which is
    // exactly why the pin could not have been keyed to it.
    expect(new Set(landed).size).toBeGreaterThan(1);
  });

  it("changes nothing when it does not keep together", () => {
    const input = lots(6);
    const plain = derive(input, { ...DEFAULT_PARAMS, perPage: 4 });
    const loose = derive(input, { ...DEFAULT_PARAMS, perPage: 4 }, [
      { keepsTogether: false, lotIds: ["p4", "p5"] },
    ]);
    expect(JSON.stringify(loose)).toBe(JSON.stringify(plain));
  });

  it("places every lot exactly once whatever is pinned", () => {
    const input = lots(11);
    const doc = derive(input, { ...DEFAULT_PARAMS, perPage: 4 }, [
      { keepsTogether: true, lotIds: ["p2", "p3", "p4"] },
      { keepsTogether: true, lotIds: ["p10", "p11"] },
    ]);
    const placed = doc.pages.flatMap((p) => p.slots.map((s) => s.lotId));
    expect(placed).toHaveLength(11);
    expect(new Set(placed).size).toBe(11);
    expect(pageOf(doc, "p10")).toBe(pageOf(doc, "p11"));
  });
});

describe("derive — where a person put things", () => {
  const F = { x: 0.1, y: 0.2, w: 0.3, h: 0.4 };
  const slotOf = (doc: ReturnType<typeof derive>, id: string) =>
    doc.pages.flatMap((p) => p.slots).find((s) => s.lotId === id)!;

  it("carries a frame to the slot's field, keyed by field and not by position", () => {
    const doc = derive(lots(3), DEFAULT_PARAMS, [], [
      { lotId: "p2", field: "title", frame: F },
    ]);
    expect(slotOf(doc, "p2").frames).toEqual({ title: F });
    // Nobody else gains one, and a document with no placements carries none —
    // which keeps every catalogue derived before this existed identical.
    expect(slotOf(doc, "p1").frames).toBeUndefined();
    expect(derive(lots(3)).pages[0]!.slots[0]!.frames).toBeUndefined();
  });

  it("puts the same frame on the same lot at every density", () => {
    // The whole reason a frame is stored against (lot, field) in page
    // fractions. Change the density and the LOT moves; where on its page the
    // title sits is the same sentence on the new page as on the old one.
    const overrides = [{ lotId: "p7", field: "title", frame: F }];
    for (const perPage of [1, 2, 4, 9]) {
      const doc = derive(lots(10), { ...DEFAULT_PARAMS, perPage }, [], overrides);
      expect(slotOf(doc, "p7").frames).toEqual({ title: F });
    }
  });

  it("frames the two things that are not entries in `fields`", () => {
    const doc = derive([lot("a", { images: ["hash"] })], DEFAULT_PARAMS, [], [
      { lotId: "a", field: "ref", frame: F },
      { lotId: "a", field: "images", frame: { x: 0.5, y: 0.5, w: 0.4, h: 0.4 } },
    ]);
    expect(Object.keys(slotOf(doc, "a").frames ?? {}).sort()).toEqual(["images", "ref"]);
  });

  it("does not apply a frame that has left the paper", () => {
    // Kept in the database and not applied, which is the rule for an override
    // whose target is gone: never deleted behind the person's back, never
    // silently believed. An edit nobody can see is an edit nobody can undo.
    const gone = [
      { x: 2, y: 0.1, w: 0.3, h: 0.3 },
      { x: 0.1, y: -0.5, w: 0.3, h: 0.3 },
      { x: Number.NaN, y: 0.1, w: 0.3, h: 0.3 },
    ];
    for (const frame of gone) {
      const doc = derive(lots(2), DEFAULT_PARAMS, [], [{ lotId: "p1", field: "title", frame }]);
      expect(slotOf(doc, "p1").frames).toBeUndefined();
    }
  });

  it("applies a frame beside a hiding and a correction on other fields", () => {
    const doc = derive([lot("a", { fields: { title: "青花瓶", maker: "佚名" } })], DEFAULT_PARAMS, [], [
      { lotId: "a", field: "title", frame: F, text: "青花纏枝蓮紋梅瓶" },
      { lotId: "a", field: "maker", hidden: true },
    ]);
    const slot = slotOf(doc, "a");
    expect(slot.frames).toEqual({ title: F });
    expect(slot.caption.find((l) => l.key === "title")?.value).toBe("青花纏枝蓮紋梅瓶");
    expect(slot.caption.find((l) => l.key === "maker")).toBeUndefined();
  });

  it("leaves a named page unapplied — see derive's note on why", () => {
    // STORED, ROUND-TRIPPED, NOT HONOURED. A page number is positional, the key
    // names a page for a FIELD rather than for a lot, and a page already full
    // cannot take another slot without breaking the grid it declares. This
    // guards the decision: nothing about pagination may start depending on it
    // by accident.
    const plain = derive(lots(10), { ...DEFAULT_PARAMS, perPage: 4 });
    for (const pageIndex of [0, 1, 99]) {
      const doc = derive(lots(10), { ...DEFAULT_PARAMS, perPage: 4 }, [], [
        { lotId: "p6", field: "title", pageIndex },
        { lotId: "p1", field: "images", pageIndex },
      ]);
      expect(doc.pages.map((p) => p.slots.map((s) => s.lotId))).toEqual(
        plain.pages.map((p) => p.slots.map((s) => s.lotId)),
      );
    }
  });
});

describe("asText", () => {
  it("flattens the predecessor's bilingual shape rather than printing [object Object]", () => {
    expect(asText({ zh: "青花瓶", en: "Blue and white vase" })).toBe("青花瓶");
    expect(asText({ en: "Only English" })).toBe("Only English");
  });

  it("leaves a price range exactly as it arrived", () => {
    // An auction estimate is a RANGE. Coercing it to a number is the failure the
    // predecessor's corpus documented.
    expect(asText("800,000 – 1,200,000 HKD")).toBe("800,000 – 1,200,000 HKD");
  });

  it("is total over anything jsonb can hold", () => {
    for (const value of [null, undefined, 0, false, [], {}, [1, "a"]]) {
      expect(() => asText(value)).not.toThrow();
    }
  });
});

describe("renderCatalogue", () => {
  const doc = derive([lot("a", { fields: { title: "青花瓶" } })], DEFAULT_PARAMS);

  it("carries the policy as the first tag in head", () => {
    // ARCHITECTURE.md principle 8. First, because a policy that arrives after
    // content has already been parsed is a policy that arrived too late.
    const html = renderCatalogue(doc);
    const head = html.slice(html.indexOf("<head>"), html.indexOf("</head>"));
    const firstTag = head.match(/<meta[^>]*>/)?.[0] ?? "";
    expect(firstTag).toContain("Content-Security-Policy");
    expect(firstTag).toContain("default-src 'none'");
  });

  it("declares no script-src at all", () => {
    // Not "script-src 'none'" — ABSENT, so it falls back to default-src and
    // cannot be widened by a later edit that only looks at the script line.
    expect(PREVIEW_CSP).not.toContain("script-src");
    expect(PREVIEW_CSP).toContain("default-src 'none'");
  });

  it("escapes content into the document", () => {
    const hostile = derive(
      [lot("x", { fields: { title: '</p><script>alert(1)</script>' } })],
      DEFAULT_PARAMS,
    );
    const html = renderCatalogue(hostile);
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("sizes the page differently for each fit, at every density", () => {
    // The predecessor shipped these two as separate controls that behaved
    // IDENTICALLY at two-up (ROADMAP M1, carried defects). This is the guard.
    for (const perPage of [1, 2, 4, 6, 9]) {
      const lotsHere = lots(perPage);
      const page = renderCatalogue(derive(lotsHere, { ...DEFAULT_PARAMS, perPage, fit: "page" }));
      const width = renderCatalogue(derive(lotsHere, { ...DEFAULT_PARAMS, perPage, fit: "width" }));
      expect(page).not.toBe(width);
      expect(page).toContain("height: calc(100vh - 32px)");
      expect(width).toContain("width: 100%");
    }
  });

  it("publishes the identity of every part, and of no structural box", () => {
    // The vocabulary a later overlay hit-tests against. `data-lot` +
    // `data-field` IS the key an override is written under, so a selection is
    // expressible as the thing that will be saved (principle 1) — and the
    // entry carries only half of it on purpose, because half an identity reads
    // as "not selectable" rather than as an edit that silently cannot be kept.
    const html = renderCatalogue(
      derive([lot("a", { fields: { title: "青花瓶" }, images: ["hash-a"] })], DEFAULT_PARAMS),
    );
    expect(html).toContain('<section class="page page--grid" data-page="1">');
    expect(html).toMatch(/<article class="slot" data-lot="a">/);
    expect(html).not.toMatch(/<article class="slot"[^>]*data-field=/);
    expect(html).toContain('data-lot="a" data-field="images"');
    expect(html).toContain('data-lot="a" data-field="title"');
    expect(html).toContain('data-lot="a" data-field="ref"');
    // Nothing a person did not place says a person placed it.
    const body = html.slice(html.indexOf("<body>"), html.indexOf("</body>"));
    expect(body).not.toContain("data-frame-source");
    expect(body).not.toContain("data-page-frame");
    expect(body).not.toContain("placed");
  });

  it("paints a placed part against the page, once, and says who placed it", () => {
    const doc = derive([lot("a", { fields: { title: "青花瓶" } })], DEFAULT_PARAMS, [], [
      { lotId: "a", field: "title", frame: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 } },
    ]);
    const html = renderCatalogue(doc);
    const page = html.slice(html.indexOf("<body>"), html.indexOf("</body>"));

    // ONCE. The part is LIFTED out of the caption, not positioned inside it —
    // a caption is a clipped box, so a part positioned within it would be cut
    // at the slot's edge and "a part may go anywhere on the paper" would be
    // nearly true, which is the predecessor's escapesSlot problem.
    expect(page.match(/data-field="title"/g)).toHaveLength(1);
    expect(page).toContain('class="line line--title placed"');
    expect(page).toContain('data-frame-source="override"');
    expect(page).toContain('data-page-frame="0.100000,0.200000,0.300000,0.400000"');
    // Page fractions, straight through, at the resolution CSS carries.
    expect(page).toContain("left: 10.0000%; top: 20.0000%; width: 30.0000%; height: 40.0000%");
    // Inside its page and after the live area, so it is above what it was
    // dragged off without a z-index anywhere.
    const live = page.indexOf('<div class="live">');
    const placed = page.indexOf("data-frame-source");
    expect(live).toBeLessThan(placed);
    expect(placed).toBeLessThan(page.indexOf("</section>"));
  });

  it("positions a placed part against the PAGE, which means the margin is not the page's", () => {
    // An absolutely positioned child is laid out against its ancestor's
    // PADDING box. With the margin on .page, "0.5 of the page" would land at
    // half of the page-minus-margins — a placement that drifts with the
    // template. The margin lives on .live so .page's padding box is the sheet.
    const html = renderCatalogue(derive([lot("a")], DEFAULT_PARAMS));
    expect(html).toMatch(/\.live \{[^}]*padding: [\d.]+%/);
    expect(html).toMatch(/\.page \{[^}]*position: relative/);
    expect(html).not.toMatch(/\.page \{[^}]*padding:/);
    // And the paper is where a bleed stops being visible, in the preview as at
    // the press: without this a bled part lands on the next page's sheet.
    expect(html).toMatch(/\.page \{[^}]*overflow: hidden/);
  });

  it("keeps a placed cell's column, because a table's flow is load-bearing", () => {
    // The colgroup declares the widths, so a row with one fewer cell shifts
    // every column after it. The content moves; the cell stays, empty.
    const doc = derive([lot("a", { fields: { title: "青花瓶" } })], {
      ...DEFAULT_PARAMS,
      template: "price-list",
    }, [], [{ lotId: "a", field: "title", frame: { x: 0.1, y: 0.1, w: 0.2, h: 0.1 } }]);
    const html = renderCatalogue(doc);
    const row = html.match(/<tr class="slot"[^>]*>.*?<\/tr>/)![0];
    expect(row.match(/<td /g)).toHaveLength(doc.columns.length);
    expect(row).toMatch(/<td class="line line--title"[^>]*><\/td>/);
    expect(html).toContain('<div class="line line--title placed"');
  });

  it("prints a placed part inside the sheet it belongs to", () => {
    // Print safety. The part is a child of its own .page, which @page sizes to
    // exactly one sheet and breaks after — so a placement cannot push a page,
    // and the fade that would read as a smear on paper is still suppressed.
    const html = renderCatalogue(
      derive([lot("a")], DEFAULT_PARAMS, [], [
        { lotId: "a", field: "title", frame: { x: 0.1, y: 0.1, w: 0.2, h: 0.1 } },
      ]),
    );
    const print = html.slice(html.indexOf("@media print"));
    expect(print).toContain("@page { size: A4; margin: 0; }");
    expect(print).toContain("break-after: page");
    expect(print).toContain(".caption::after { display: none; }");
    const section = html.match(/<section class="page[^]*?<\/section>/)![0];
    expect(section).toContain("data-frame-source");
  });

  it("paints one blank sheet for a document with no pages, and nothing on it", () => {
    // The engine says zero pages, truthfully — that is the number the editor's
    // counts, the PDF header and the exports ledger read. The renderer still
    // shows paper: a new event lands on the editor (M1.md §1 step 2), and an
    // editor is a page, not a card about the absence of one.
    const blank = derive([], DEFAULT_PARAMS);
    expect(blank.pages).toHaveLength(0);
    expect(blank.lotCount).toBe(0);

    const html = renderCatalogue(blank);
    const body = html.slice(html.indexOf("<body>"), html.indexOf("</body>"));
    expect(body.match(/<section class="page /g)).toHaveLength(1);
    expect(body).toContain('class="page page--empty"');
    // A sheet on the desk, not page one: no folio, no page number, no slot.
    expect(body).not.toContain("data-page");
    expect(body).not.toContain('class="folio"');
    expect(body).not.toContain('class="slot');
    // Sized as a PAGE — the template's aspect, fitted by height — and not as a
    // box around a sentence: the rule that once made .page--empty auto-sized is
    // gone, and the .page rule carries the geometry.
    expect(html).not.toMatch(/\.page--empty\s*\{/);
    expect(html).toContain("aspect-ratio: 210 / 297;");
    expect(html).toContain("height: calc(100vh - 32px)");
  });
});
