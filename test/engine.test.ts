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
});
