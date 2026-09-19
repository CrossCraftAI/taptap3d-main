// Templates as data — the vocabulary, and the three shapes it has to say.
//
// The test that matters is the one that would FAIL on the old shape with more
// knobs: a price list is a table and a catalogue is a grid, and a test that only
// counted pages would pass on two identical layouts. So these read the document
// tree and the markup and assert that the SHAPE changed — table rows under a
// header, a description list on a sheet, cells in a grid — through one
// renderer. And that a correction keyed to a lot survives the change, because
// nothing about it said which shape it was made on.

import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  DEFAULT_PARAMS,
  derive,
  normaliseParams,
  type CatalogueDocument,
  type EngineLot,
} from "@/lib/engine/derive";
import {
  BUILT_IN_TEMPLATES,
  CATALOGUE,
  PRICE_LIST,
  TEARSHEET,
  templateFor,
  templateSchema,
  type Template,
  type TemplateInput,
} from "@/lib/engine/templates";
import { renderCatalogue } from "@/lib/render/html";

const ROOT = path.resolve(import.meta.dirname, "..");

function lot(id: string, overrides: Partial<EngineLot> = {}): EngineLot {
  return { id, ref: id.toUpperCase(), fields: { title: `Lot ${id}` }, images: [], ...overrides };
}

const PROSE = "此作為趙無極晚期重要油畫，展現其成熟的抽象風格。".repeat(12);

/** Five lots, varied enough that a table's columns and a grid's lines differ. */
const SALE: EngineLot[] = [
  lot("a", {
    fields: { title: "青花纏枝蓮紋梅瓶", maker: "佚名", date: "清乾隆", material: "瓷", dimensions: "高 32.5 cm", price: "800,000 – 1,200,000 HKD", description: "器形端莊。", 品相: "全品" },
    images: ["plate-a"],
  }),
  lot("b", { fields: { title: "山水四屏", maker: "張大千", price: "3,500,000 – 4,800,000 HKD", description: PROSE } }),
  // No maker, deliberately: a table must still give it a maker cell.
  lot("c", { fields: { title: "白玉雕螭龍紋佩", price: "180,000 – 260,000 HKD", 來源: "香港私人收藏" } }),
  lot("d", { fields: { title: "墨荷", maker: "齊白石", date: "1950", price: "400,000 – 600,000 HKD" } }),
  lot("e", { fields: { title: "紫砂壺", maker: "顧景舟", price: "200,000 – 300,000 HKD" } }),
];

/** Parameters for a template, at its own default density. */
const on = (template: Template, extra: Partial<typeof DEFAULT_PARAMS> = {}) => ({
  ...DEFAULT_PARAMS,
  template: template.id,
  perPage: template.defaultPerPage,
  ...extra,
});

const slotOf = (doc: CatalogueDocument, id: string) =>
  doc.pages.flatMap((p) => p.slots).find((s) => s.lotId === id)!;
const keysOf = (doc: CatalogueDocument, id: string): string[] =>
  slotOf(doc, id).caption.map((l) => l.key);
const body = (html: string): string => html.slice(html.indexOf("<body>"), html.indexOf("</body>"));

/** A house-authored template: what a museum's object label might declare. */
const MUSEUM_LABEL: TemplateInput = {
  id: "museum-label",
  name: { zh: "展品標籤", en: "Object label" },
  purpose: "Six labels to a landscape sheet, the accession number last.",
  arrangement: "grid",
  page: { size: "A4", orientation: "landscape", margin: 4 },
  type: { body: 1.4, cap: 13 },
  densities: [{ perPage: 6, columns: 3, fields: 4, lines: 8, units: 120 }],
  defaultPerPage: 6,
  plate: { above: 0.5 },
  fields: [
    { key: "title", priority: 1 },
    { key: "maker", priority: 2 },
    { key: "date", priority: 3 },
    { key: "material", priority: 4, label: true },
    { key: "ref" },
  ],
};

describe("the vocabulary", () => {
  it("validates every built-in, each under its own id", () => {
    for (const template of BUILT_IN_TEMPLATES) {
      expect(() => templateSchema.parse(template)).not.toThrow();
    }
    const ids = BUILT_IN_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    // And they are three ARRANGEMENTS, not three sets of numbers.
    expect(new Set(BUILT_IN_TEMPLATES.map((t) => t.arrangement)).size).toBe(3);
  });

  it("accepts a house-authored template", () => {
    expect(() => templateSchema.parse(MUSEUM_LABEL)).not.toThrow();
  });

  const bad: [string, (t: TemplateInput) => TemplateInput][] = [
    ["a grid density with no columns", (t) => ({ ...t, densities: [{ perPage: 6, fields: 4, lines: 8, units: 120 }] })],
    ["columns that do not divide the density", (t) => ({ ...t, densities: [{ perPage: 6, columns: 4, fields: 4, lines: 8, units: 120 }] })],
    ["a default density that is not offered", (t) => ({ ...t, defaultPerPage: 9 })],
    ["the same density offered twice", (t) => ({ ...t, densities: [t.densities[0]!, { ...t.densities[0]! }] })],
    ["a sheet with two to a page", (t) => ({ ...t, arrangement: "sheet", densities: [{ perPage: 2, fields: 4, lines: 8, units: 120 }], defaultPerPage: 2 })],
    ["a table with columns", (t) => ({ ...t, arrangement: "table", plate: null })],
    ["a table with its plate above the row", (t) => ({ ...t, arrangement: "table", densities: [{ perPage: 6, fields: 4, lines: 8, units: 120 }], plate: { above: 0.5 } })],
    ["a plate offered nowhere", (t) => ({ ...t, plate: {} })],
    ["a field declared twice", (t) => ({ ...t, fields: [...t.fields, { key: "title" }] })],
    ["the plate as a field", (t) => ({ ...t, fields: [...t.fields, { key: "images" }] })],
    ["a carried-data key as a field", (t) => ({ ...t, fields: [...t.fields, { key: "_height" }] })],
    ["an arrangement the renderer does not know", (t) => ({ ...t, arrangement: "canvas" as never })],
    ["an id that is not a slug", (t) => ({ ...t, id: "Museum Label" })],
  ];
  it.each(bad)("refuses %s", (_name, mutate) => {
    expect(templateSchema.safeParse(mutate(MUSEUM_LABEL)).success).toBe(false);
  });
});

describe("parameters resolve against the template, not against the engine", () => {
  it("a density the template does not offer becomes the template's default", () => {
    // Four-up means nothing to a price list; twenty rows means nothing to a grid.
    expect(normaliseParams({ template: "price-list", perPage: 4 }).perPage).toBe(20);
    expect(normaliseParams({ template: "catalogue", perPage: 20 }).perPage).toBe(4);
    expect(normaliseParams({ template: "tearsheet", perPage: 9 }).perPage).toBe(1);
  });

  it("a row written before templates existed is a catalogue", () => {
    // catalogues.params from the previous version: no template key at all.
    const params = normaliseParams({ perPage: 9, imagePlacement: "beside", showRef: false, fit: "width" });
    expect(params).toEqual({ template: "catalogue", perPage: 9, imagePlacement: "beside", showRef: false, fit: "width" });
    expect(normaliseParams({ template: "nonsense" }).template).toBe("catalogue");
  });

  it("a placement the template has no plate for becomes the one it has", () => {
    expect(normaliseParams({ template: "price-list", imagePlacement: "above" }).imagePlacement).toBe("beside");
    expect(normaliseParams({ template: "tearsheet", imagePlacement: "beside" }).imagePlacement).toBe("beside");
  });

  it("a house-authored template is chosen through the library", () => {
    const house = templateSchema.parse(MUSEUM_LABEL);
    const library = [...BUILT_IN_TEMPLATES, house];
    expect(normaliseParams({ template: "museum-label" }, library).perPage).toBe(6);
    expect(templateFor("museum-label", library)).toBe(house);
    // Without it in the library the same id is nobody, and nobody is the catalogue.
    expect(templateFor("museum-label").id).toBe("catalogue");
  });
});

describe("three templates, three shapes", () => {
  const grid = derive(SALE, on(CATALOGUE));
  const table = derive(SALE, on(PRICE_LIST));
  const sheet = derive(SALE, on(TEARSHEET));

  it("the same lots paginate differently under each", () => {
    expect(grid.pages.length).toBe(2); // 5 at 4-up
    expect(table.pages.length).toBe(1); // 5 of 20 rows
    expect(sheet.pages.length).toBe(5); // one to a page
    for (const doc of [grid, table, sheet]) {
      const placed = doc.pages.flatMap((p) => p.slots.map((s) => s.lotId));
      expect(placed).toEqual(["a", "b", "c", "d", "e"]);
    }
  });

  it("the catalogue is a grid of cells", () => {
    expect(grid.template.arrangement).toBe("grid");
    expect(grid.columns).toEqual([]);
    const html = body(renderCatalogue(grid));
    expect(html).toContain('<section class="page page--grid"');
    expect(html).toContain('<div class="grid">');
    expect(html).toMatch(/<article class="slot" data-lot="a">/);
    expect(html).not.toContain("<table");
    expect(html).not.toContain("<dl");
    // A lot without a maker has no maker line: the grid decides per lot.
    expect(keysOf(grid, "c")).not.toContain("maker");
  });

  it("the price list is a table with a header, and every row has every column", () => {
    expect(table.template.arrangement).toBe("table");
    expect(table.columns.map((c) => c.key)).toEqual(["ref", "images", "title", "maker", "price"]);
    // The column shares are resolved by the engine and sum to the row.
    expect(table.columns.reduce((sum, c) => sum + c.width, 0)).toBeCloseTo(1, 6);
    expect(table.columns.find((c) => c.key === "images")!.width).toBeCloseTo(0.1, 6);

    const html = body(renderCatalogue(table));
    expect(html).toContain('<section class="page page--table"');
    expect(html).toContain("<table>");
    expect(html).toContain("<thead>");
    expect(html).toContain('<th class="line line--title">品名</th>');
    expect(html).toContain('<th class="line line--maker">作者</th>');
    expect(html).toContain('<th class="line line--price">估價</th>');
    expect(html).not.toContain('class="grid"');
    expect(html).not.toContain("<dl");

    // Every row has the same five cells, whatever the lot has.
    const rows = html.match(/<tr class="slot"[^>]*>.*?<\/tr>/g) ?? [];
    expect(rows).toHaveLength(5);
    for (const row of rows) expect(row.match(/<td /g)).toHaveLength(5);
    // The lot with no maker: a maker cell, empty. The eye running down the
    // estimate column must not land on a maker.
    const c = rows.find((r) => r.includes(">C<"))!;
    expect(c).toMatch(/<td class="line line--maker"[^>]*><div class="cell"><\/div><\/td>/);
    // The lot with a plate has a thumbnail in its plate cell; the others have the cell.
    expect(rows.find((r) => r.includes(">A<"))).toMatch(
      /<td class="plate"[^>]*><div class="cell"><img/,
    );
    expect(c).toMatch(/<td class="plate"[^>]*><div class="cell"><\/div><\/td>/);
    // The house's own column does not become a fifth column: the template has no `*`.
    expect(table.columns.map((c) => c.key)).not.toContain("品相");
  });

  it("the tearsheet is one lot to a page, with the whole description", () => {
    expect(sheet.template.arrangement).toBe("sheet");
    for (const page of sheet.pages) expect(page.slots).toHaveLength(1);
    // Nothing shortened. A nine-up grid cuts this prose to a line and says so;
    // a sheet is the page where it all prints.
    expect(slotOf(sheet, "b").caption.find((l) => l.key === "description")!.value).toBe(PROSE);
    const dense = slotOf(derive(SALE, on(CATALOGUE, { perPage: 9 })), "b").caption.find((l) => l.key === "description")!.value;
    expect(dense.endsWith("…")).toBe(true);
    expect(dense.length).toBeLessThan(PROSE.length / 4);

    const html = body(renderCatalogue(sheet));
    expect(html).toContain('<section class="page page--sheet"');
    expect(html).toMatch(/<article class="slot slot--sheet" data-lot="[^"]+">/);
    expect(html).toContain('<dl class="caption">');
    expect(html).toContain('<dt class="label">尺寸</dt>');
    // The specifications carry their labels; the title does not.
    expect(html).toContain('class="line line--dimensions labelled"');
    expect(html).toContain('class="line line--title"');
    // The house's own column prints, labelled, where `*` sits.
    expect(html).toMatch(/class="line line--來源 labelled"[^>]*><dt class="label">來源<\/dt>/);
    expect(html).not.toContain("<table");
    expect(html).not.toContain('class="grid"');
  });

  it("is one renderer: every shape carries the policy first and escapes its content", () => {
    const hostile = [lot("x", { fields: { title: "</td><script>alert(1)</script>", maker: "<b>m</b>" } })];
    for (const template of BUILT_IN_TEMPLATES) {
      const html = renderCatalogue(derive(hostile, on(template)));
      const head = html.slice(html.indexOf("<head>"), html.indexOf("</head>"));
      expect(head.match(/<meta[^>]*>/)?.[0]).toContain("default-src 'none'");
      expect(html).not.toContain("<script>alert(1)</script>");
      expect(html).not.toContain("<b>m</b>");
    }
    // Held by the file, not by a comment: one exported painter.
    const source = readFileSync(path.join(ROOT, "src/lib/render/html.ts"), "utf8");
    expect(source.match(/^export function /gm)).toHaveLength(1);
  });
});

describe("what the template says, the page does", () => {
  const house = templateSchema.parse(MUSEUM_LABEL);
  const library = [...BUILT_IN_TEMPLATES, house];
  const labels = derive(SALE, on(house), [], [], library);
  const html = renderCatalogue(labels);

  it("orientation reaches the preview page and the printed sheet", () => {
    expect(html).toContain("aspect-ratio: 297 / 210;");
    expect(html).toContain("size: A4 landscape;");
    expect(html).toContain("height: 210mm; width: 297mm;");
    const portrait = renderCatalogue(derive(SALE, on(CATALOGUE)));
    expect(portrait).toContain("aspect-ratio: 210 / 297;");
    expect(portrait).toContain("size: A4;");
    expect(portrait).toContain("height: 297mm; width: 210mm;");
  });

  it("margins, plate shares, type and budgets are the template's numbers", () => {
    expect(html).toContain("padding: 4%;");
    expect(html).toContain("flex: 0 0 50%;");
    expect(html).toContain("clamp(7px, 1.4vh, 13px)");
    expect(html).toContain("grid-template-columns: repeat(3, minmax(0, 1fr));");
    expect(html).toContain("grid-template-rows: repeat(2, minmax(0, 1fr));");
    expect(html).toContain("max-height: calc(1.45em * 8);");
    // Four fields at this density, so the lot with five gives one up — by the
    // template's priority, not the engine's.
    expect(keysOf(labels, "a")).toEqual(["title", "maker", "date", "material"]);
    // And no `*`, so the house's own column does not print here.
    expect(keysOf(labels, "c")).not.toContain("來源");
  });

  it("the reference prints where the fields put it — last, on a museum label", () => {
    const cell = body(html).match(/<article class="slot"[^>]*>.*?<\/article>/)![0];
    const refAt = cell.indexOf('class="ref"');
    const lastLine = cell.lastIndexOf('class="line ');
    expect(refAt).toBeGreaterThan(lastLine);
    // Whereas the catalogue names it first, so it leads — as it always has.
    const catalogueCell = body(renderCatalogue(derive(SALE, on(CATALOGUE)))).match(/<article class="slot"[^>]*>.*?<\/article>/)![0];
    expect(catalogueCell.indexOf('class="ref"')).toBeLessThan(catalogueCell.indexOf('class="line '));
  });

  it("a template that does not name the reference prints none", () => {
    const anonymous = templateSchema.parse({ ...MUSEUM_LABEL, id: "anon", fields: MUSEUM_LABEL.fields.filter((f) => f.key !== "ref") });
    const doc = derive(SALE, on(anonymous), [], [], [anonymous]);
    expect(slotOf(doc, "a").ref).toBeNull();
    expect(renderCatalogue(doc)).not.toContain('class="ref"');
  });

  it("puts the house's own columns where `*` is, in a grid and in a table", () => {
    const early = templateSchema.parse({
      ...MUSEUM_LABEL, id: "early", plate: null,
      densities: [{ perPage: 6, columns: 3, fields: 10, lines: 12, units: 200 }],
      fields: [{ key: "title" }, { key: "*" }, { key: "description" }],
    });
    const doc = derive(SALE, on(early), [], [], [early]);
    // `*` is EVERYTHING the template did not name — a core field it left out
    // is the house's own column as far as this template is concerned — in the
    // record's own order, at the place of `*`.
    expect(keysOf(doc, "a")).toEqual([
      "title", "maker", "date", "material", "dimensions", "price", "品相", "description",
    ]);

    const ledger = templateSchema.parse({
      ...MUSEUM_LABEL, id: "ledger", arrangement: "table", plate: null,
      densities: [{ perPage: 30, fields: 12, lines: 1, units: 200 }], defaultPerPage: 30,
      fields: [{ key: "ref" }, { key: "title", width: 3 }, { key: "maker" }, { key: "*" }],
    });
    const rows = derive(SALE, on(ledger), [], [], [ledger]);
    // Everything the template did not name, as columns: the UNION across the
    // lots in first-seen order, after the named columns. Lot a's unnamed core
    // fields come first because lot a comes first; lot c's 來源 is last because
    // nobody before it had one.
    expect(rows.columns.map((c) => c.key)).toEqual([
      "ref", "title", "maker", "date", "material", "dimensions", "price", "description", "品相", "來源",
    ]);
    // Cut to a budget, the same union is cut in the same order — a column is
    // never dropped for one lot and kept for another.
    const narrow = templateSchema.parse({ ...ledger, id: "narrow", densities: [{ perPage: 30, fields: 4, lines: 1, units: 200 }] });
    expect(derive(SALE, on(narrow), [], [], [narrow]).columns.map((c) => c.key)).toEqual([
      "ref", "title", "maker", "date", "material",
    ]);
    // A row has cells for both and a value for one.
    const rendered = body(renderCatalogue(rows));
    const c = (rendered.match(/<tr class="slot"[^>]*>.*?<\/tr>/g) ?? []).find((r) => r.includes(">C<"))!;
    expect(c).toMatch(/<td class="line line--品相"[^>]*><div class="cell"><\/div><\/td>/);
    expect(c).toMatch(/<td class="line line--來源"[^>]*><div class="cell"><span class="value">香港私人收藏<\/span><\/div><\/td>/);
  });

  it("drops the reference column when this catalogue does not print one", () => {
    const doc = derive(SALE, on(PRICE_LIST, { showRef: false }));
    expect(doc.columns.map((c) => c.key)).toEqual(["images", "title", "maker", "price"]);
    expect(renderCatalogue(doc)).not.toContain('<th class="ref">');
    expect(slotOf(doc, "a").ref).toBeNull();
  });

  it("bounds a table's cell to its column's share of the row", () => {
    const title = "清乾隆御製琺瑯彩胭脂紅地纏枝蓮紋題詩小瓶一對連原裝木座".repeat(1);
    const wordy = [lot("w", { fields: { title, maker: "佚名", price: "1,000 HKD" } })];
    // 110 units across ref(1.2), title(4), maker(2.4) and price(2.4): the
    // title gets four tenths of the row, forty-four units, twenty-two
    // characters — and this one is longer.
    const dense = derive(wordy, on(PRICE_LIST, { perPage: 28 }));
    const printed = slotOf(dense, "w").caption.find((l) => l.key === "title")!.value;
    expect(printed.endsWith("…")).toBe(true);
    expect(printed.length).toBeLessThan(title.length);
    // With three lines to a cell, fourteen rows to a page, it fits whole.
    const roomy = derive(wordy, on(PRICE_LIST, { perPage: 14 }));
    expect(slotOf(roomy, "w").caption.find((l) => l.key === "title")!.value).toBe(title);
    // The record is untouched.
    expect(wordy[0]!.fields.title).toBe(title);
  });
});

describe("corrections survive a change of template", () => {
  const overrides = [
    { lotId: "b", field: "maker", hidden: true },
    { lotId: "b", field: "price", text: "估價待詢" },
    { lotId: "a", field: "images", hidden: true },
  ];

  it.each(BUILT_IN_TEMPLATES.map((t) => [t.id, t] as const))(
    "the same overrides land on the %s",
    (_id, template) => {
      const doc = derive(SALE, on(template), [], overrides);
      const b = slotOf(doc, "b");
      expect(b.caption.map((l) => l.key)).not.toContain("maker");
      expect(b.caption.find((l) => l.key === "price")?.value).toBe("估價待詢");
      // The plate hidden in this catalogue is hidden in this shape too, and the
      // lot still HAS a photograph.
      expect(slotOf(doc, "a").image).toBeNull();
      expect(doc.unphotographed).toBe(4);
    },
  );

  it("a hidden maker is an empty cell in a table, not a missing one", () => {
    const doc = derive(SALE, on(PRICE_LIST), [], overrides);
    expect(doc.columns.map((c) => c.key)).toContain("maker");
    const rows = body(renderCatalogue(doc)).match(/<tr class="slot"[^>]*>.*?<\/tr>/g) ?? [];
    const b = rows.find((r) => r.includes(">B<"))!;
    expect(b).toMatch(/<td class="line line--maker"[^>]*><div class="cell"><\/div><\/td>/);
    // THE CONTROL: the lot beside it still has its maker.
    expect(rows.find((r) => r.includes(">D<"))).toContain("齊白石");
  });

  it("a pin holds in a table exactly as it holds in a grid", () => {
    const many = Array.from({ length: 25 }, (_, i) => lot(`p${i + 1}`));
    const pins = [{ keepsTogether: true, lotIds: ["p20", "p21"] }];
    const pageOf = (doc: CatalogueDocument, id: string): number =>
      doc.pages.find((p) => p.slots.some((s) => s.lotId === id))!.number;
    const table = derive(many, on(PRICE_LIST), pins); // 20 rows: p20 would end page one
    expect(pageOf(table, "p20")).toBe(pageOf(table, "p21"));
    expect(table.pages[0]!.slots).toHaveLength(19);
    const grid = derive(many, on(CATALOGUE, { perPage: 4 }), pins); // p20 would end page five
    expect(pageOf(grid, "p20")).toBe(pageOf(grid, "p21"));
  });

  it("is deterministic under every template", () => {
    for (const template of BUILT_IN_TEMPLATES) {
      expect(JSON.stringify(derive(SALE, on(template), [], overrides))).toBe(
        JSON.stringify(derive(SALE, on(template), [], overrides)),
      );
    }
  });
});
