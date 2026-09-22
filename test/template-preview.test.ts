// The template tile — and the pin that keeps it a mirror.
//
// A tile is a diagram of a page, so the only interesting question about it is
// whether it still agrees with the page. Two halves answer that:
//
//   THE PIN. The tile computes its geometry from four numbers that are
//   literals in html.ts's stylesheet. Those are asserted against a REAL
//   RENDERED DOCUMENT, not against the source text — change `gap: 4%` in the
//   renderer and this fails naming the rule, which is the whole reason the
//   tile is allowed to mirror anything at all.
//
//   THE SHAPE. That a four-up tile has four cells in two columns, that a
//   price list has a header band and twenty rows, that `beside` puts the plate
//   on the left, that a sale with two lots still fills a six-up tile. These
//   are the things a hand-drawn SVG would have got right once and then stopped
//   getting right.

import { describe, expect, it } from "vitest";

import {
  DEFAULT_PARAMS,
  derive,
  type CatalogueParams,
  type EngineLot,
} from "@/lib/engine/derive";
import {
  BUILT_IN_TEMPLATES,
  CATALOGUE,
  PRICE_LIST,
  TEARSHEET,
  templateSchema,
  type Template,
  type TemplateInput,
} from "@/lib/engine/templates";
import { renderCatalogue } from "@/lib/render/html";
import {
  FOLIO_MARGIN,
  GRID_GAP,
  SHEET_GAP,
  SHEET_GAP_BESIDE,
  lotsForTile,
  templateTiles,
  type ProxyBlock,
  type TemplateTile,
} from "@/lib/render/template-preview";

const lot = (id: string, images: string[] = [`plate-${id}`]): EngineLot => ({
  id,
  ref: `P${id}`,
  fields: {
    title: "青花纏枝蓮紋梅瓶",
    maker: "佚名",
    date: "清乾隆",
    price: "800,000 – 1,200,000 HKD",
  },
  images,
});

const SALE = ["a", "b", "c", "d", "e", "f"].map((id) => lot(id));

const tilesOf = (
  lots: EngineLot[] = SALE,
  params: CatalogueParams = DEFAULT_PARAMS,
  library?: readonly Template[],
): TemplateTile[] =>
  templateTiles(library ? { lots, params, library } : { lots, params });

const tile = (id: string, ...rest: Parameters<typeof tilesOf>): TemplateTile =>
  tilesOf(...rest).find((t) => t.id === id)!;

const plates = (t: TemplateTile): ProxyBlock[] => t.blocks.filter((b) => b.kind === "plate");
const texts = (t: TemplateTile): ProxyBlock[] => t.blocks.filter((b) => b.kind === "text");
/** Distinct to three decimals — enough to tell a column from a rounding error. */
const distinct = (values: number[]): number[] =>
  [...new Set(values.map((v) => Number(v.toFixed(3))))].sort((a, b) => a - b);

// ── THE PIN ─────────────────────────────────────────────────────────────────

describe("the numbers this file mirrors are still the renderer's", () => {
  const renderOf = (template: Template): string =>
    renderCatalogue(
      derive(SALE, { ...DEFAULT_PARAMS, template: template.id, perPage: template.defaultPerPage }),
    );

  /**
   * One rule of the rendered stylesheet, by its exact selector.
   *
   * SCOPED TO THE RULE, and that is the whole of what makes this a pin. The
   * first version asserted the number against the WHOLE DOCUMENT, and it
   * passed with the constant deliberately wrong — because html.ts emits its
   * stylesheet whole for every document, so `gap: 5%` was found in the sheet's
   * side-by-side rule while the grid's gap was 4%. Measured, by breaking
   * GRID_GAP and watching twenty-eight tests stay green. golden.test.ts's
   * header warns about the same property of this file from the other side.
   */
  const rule = (html: string, selector: string): string => {
    const at = html.indexOf(`${selector} {`);
    if (at < 0) throw new Error(`the renderer has no rule for ${selector}`);
    return html.slice(at, html.indexOf("}", at) + 1);
  };

  it("the extractor reads one rule and not the file", () => {
    // The control for the paragraph above: two rules, two different gaps, and
    // neither answer contaminated by the other.
    const html = renderOf(CATALOGUE);
    expect(rule(html, ".page--sheet .slot--beside")).toContain("gap: 5%");
    expect(rule(html, ".page--grid .grid")).not.toContain("gap: 5%");
  });

  it.each<[string, Template, string, string]>([
    ["the gap between a grid's cells", CATALOGUE, ".page--grid .grid", `gap: ${GRID_GAP * 100}%`],
    ["the strip the folio sits in", CATALOGUE, ".folio", `margin-top: ${FOLIO_MARGIN * 100}%`],
    ["the gap on a sheet", TEARSHEET, ".page--sheet .slot", `gap: ${SHEET_GAP * 100}%`],
    [
      "the gap on a sheet, side by side",
      TEARSHEET,
      ".page--sheet .slot--beside",
      `gap: ${SHEET_GAP_BESIDE * 100}%`,
    ],
    // Not literals — these are the template's — but the tile has to read them
    // the way the stylesheet spends them. A percentage padding is a share of
    // the containing block's WIDTH on all four sides, and a tile that used the
    // same fraction on both axes would have square margins on a page that has
    // not got them.
    ["the live area's inset", CATALOGUE, ".live", `padding: ${CATALOGUE.page.margin}%`],
    [
      "the plate's share above a caption",
      CATALOGUE,
      ".page--grid .plate",
      `flex: 0 0 ${CATALOGUE.plate!.above! * 100}%`,
    ],
    [
      "the plate's share beside one",
      CATALOGUE,
      ".page--grid .slot--beside .plate",
      `flex: 0 0 ${CATALOGUE.plate!.beside! * 100}%`,
    ],
    // A declared grid, not a flow: the tile divides the live area into the
    // same rows and columns, which a flow would put somewhere it cannot know.
    ["a grid's declared cells", CATALOGUE, ".page--grid .grid", "repeat(2, minmax(0, 1fr))"],
    [
      "a table's equal rows",
      PRICE_LIST,
      ".page--table tr.slot",
      `height: ${(100 / PRICE_LIST.defaultPerPage).toFixed(3)}%`,
    ],
  ])("%s", (_what, template, selector, expected) => {
    expect(rule(renderOf(template), selector)).toContain(expected);
  });
});

// ── THE SHAPE ───────────────────────────────────────────────────────────────

describe("every tile", () => {
  it("is offered for every template in the library, in its order", () => {
    expect(tilesOf().map((t) => t.id)).toEqual(BUILT_IN_TEMPLATES.map((t) => t.id));
  });

  it("carries what a control needs to offer it", () => {
    const t = tile("price-list");
    expect(t).toMatchObject({
      name: PRICE_LIST.name,
      purpose: PRICE_LIST.purpose,
      arrangement: "table",
      perPage: PRICE_LIST.defaultPerPage,
    });
  });

  it("is drawn at the template's own default density, never the catalogue's", () => {
    // The catalogue is on nine-up; the price list tile is still twenty rows.
    // A tile is an OFFER, and offering one template at another's density is a
    // picture of neither.
    const at9: CatalogueParams = { ...DEFAULT_PARAMS, perPage: 9 };
    expect(tile("catalogue", SALE, at9).perPage).toBe(CATALOGUE.defaultPerPage);
    expect(tile("price-list", SALE, at9).perPage).toBe(PRICE_LIST.defaultPerPage);
  });

  it("stays on the paper", () => {
    // `.page` clips — that is the trim — so a tile that painted outside its
    // own rectangle would read as a rendering fault rather than as a page.
    for (const t of tilesOf()) {
      for (const b of t.blocks) {
        expect(b.x, t.id).toBeGreaterThanOrEqual(0);
        expect(b.y, t.id).toBeGreaterThanOrEqual(0);
        expect(b.x + b.w, t.id).toBeLessThanOrEqual(1.0001);
        expect(b.y + b.h, t.id).toBeLessThanOrEqual(1.0001);
        expect(b.w * b.h, t.id).toBeGreaterThan(0);
      }
    }
  });

  it("is the shape of its own paper", () => {
    const landscape = templateSchema.parse({
      ...CATALOGUE,
      id: "wall-label",
      page: { ...CATALOGUE.page, orientation: "landscape" },
    } satisfies TemplateInput);
    expect(tile("catalogue").aspect).toBeCloseTo(210 / 297, 6);
    expect(tile("wall-label", SALE, DEFAULT_PARAMS, [landscape]).aspect).toBeCloseTo(297 / 210, 6);
  });
});

describe("a grid of cells", () => {
  const t = () => tile("catalogue");

  it("has one plate box per lot on the page, whatever the density", () => {
    expect(plates(t())).toHaveLength(CATALOGUE.defaultPerPage);
  });

  it("puts them in the density's columns and rows", () => {
    // Four-up is two across and two down, which is two distinct lefts and two
    // distinct tops — the thing a hand-drawn tile gets right once.
    expect(distinct(plates(t()).map((b) => b.x))).toHaveLength(2);
    expect(distinct(plates(t()).map((b) => b.y))).toHaveLength(2);
  });

  it("insets the live area by the margin, and by LESS of the page's height", () => {
    // A percentage padding is a share of the containing block's WIDTH on all
    // four sides, so on a portrait page the same margin is a smaller fraction
    // of the height. A tile that used the same number on both axes would have
    // visibly square margins on a page that has not got them.
    const m = CATALOGUE.page.margin / 100;
    const left = Math.min(...t().blocks.map((b) => b.x));
    const top = Math.min(...t().blocks.map((b) => b.y));
    expect(left).toBeCloseTo(m, 6);
    expect(top).toBeCloseTo(m * (210 / 297), 6);
    expect(top).toBeLessThan(left);
  });

  it("draws a plate box for a lot with no photograph", () => {
    // The renderer paints an empty plate as a dashed box of the same size, and
    // the tile is a picture of the ARRANGEMENT, not of what is in it.
    const unphotographed = SALE.map((l) => ({ ...l, images: [] }));
    expect(plates(tile("catalogue", unphotographed))).toHaveLength(CATALOGUE.defaultPerPage);
  });

  it("moves the plate to the side of the entry when the catalogue says so", () => {
    const beside: CatalogueParams = { ...DEFAULT_PARAMS, imagePlacement: "beside" };
    const above = plates(tile("catalogue"))[0]!;
    const side = plates(tile("catalogue", SALE, beside))[0]!;
    // Above: full cell width, a share of its height. Beside: the other way.
    expect(side.w).toBeLessThan(above.w);
    expect(side.h).toBeGreaterThan(above.h);
    expect(side.w / above.w).toBeCloseTo(CATALOGUE.plate!.beside!, 6);
  });

  it("draws the caption the engine derived, capped, and not one row more", () => {
    // Four rows is the cap; the fixture's lots carry four printable fields
    // plus the reference, so this is the cap doing the work.
    const perLot = texts(t()).length / CATALOGUE.defaultPerPage;
    expect(perLot).toBeLessThanOrEqual(4);
    expect(perLot).toBeGreaterThan(0);
  });

  it("gives a longer line a longer bar", () => {
    // The width is the line's own length against the budget one line may
    // spend. A barcode of equal bars would say nothing; equal bars here would
    // mean the budget had stopped being read.
    expect(distinct(texts(t()).map((b) => b.w)).length).toBeGreaterThan(1);
  });
});

describe("a table of rows under a header", () => {
  const t = () => tile("price-list");

  it("has a header band and one row per lot", () => {
    // Twenty rows plus the head is twenty-one bands; the rows' tops are
    // twenty distinct numbers.
    const tops = distinct(t().blocks.map((b) => b.y));
    expect(tops).toHaveLength(PRICE_LIST.defaultPerPage + 1);
  });

  it("lines its plate column up down the page", () => {
    const xs = distinct(plates(t()).map((b) => b.x));
    expect(xs).toHaveLength(1);
    expect(plates(t())).toHaveLength(PRICE_LIST.defaultPerPage);
  });

  it("takes the column widths the engine resolved, not its own", () => {
    const doc = derive(lotsForTile(SALE, PRICE_LIST.defaultPerPage), {
      ...DEFAULT_PARAMS,
      template: PRICE_LIST.id,
      perPage: PRICE_LIST.defaultPerPage,
    });
    const live = 1 - (2 * PRICE_LIST.page.margin) / 100;
    const plate = doc.columns.find((c) => c.key === "images")!;
    expect(plates(t())[0]!.w).toBeCloseTo(live * plate.width, 6);
  });

  it("leaves a cell blank where the row has nothing, as the markup does", () => {
    // A price list owes every row every column; a lot with no maker gets an
    // empty `<td>` holding the column open, and an empty cell draws nothing.
    const noMaker = SALE.map((l) => ({ ...l, fields: { ...l.fields, maker: "" } }));
    expect(texts(tile("price-list", noMaker)).length).toBeLessThan(
      texts(tile("price-list")).length,
    );
  });
});

describe("a page as one entry", () => {
  it("is one plate and one caption", () => {
    expect(plates(tile("tearsheet"))).toHaveLength(1);
    expect(texts(tile("tearsheet")).length).toBeGreaterThan(0);
  });

  it("gives the plate the sheet's own share, which is not the grid's", () => {
    expect(plates(tile("tearsheet"))[0]!.h / (1 - 2 * (TEARSHEET.page.margin / 100) * (210 / 297)))
      .toBeGreaterThan(0.3);
  });
});

describe("what a small sale gets", () => {
  it("fills a tile by repeating, rather than drawing a half-empty page", () => {
    // A two-lot sale on a four-up template. The tile is a diagram of an
    // ARRANGEMENT: repeating a lot says nothing false about the catalogue,
    // whereas two empty cells says the template leaves them empty.
    expect(lotsForTile(SALE.slice(0, 2), 4).map((l) => l.id)).toEqual(["a", "b", "a", "b"]);
    expect(plates(tile("catalogue", SALE.slice(0, 2)))).toHaveLength(4);
  });

  it("draws nothing at all for a sale with no lots, and is still offered", () => {
    // The engine truthfully derives no pages. The tile stays pickable — a
    // person opening a blank editor still has to be able to choose a template.
    expect(lotsForTile([], 4)).toEqual([]);
    for (const t of tilesOf([])) {
      expect(t.blocks, t.id).toEqual([]);
      expect(t.purpose, t.id).not.toBe("");
    }
  });
});
