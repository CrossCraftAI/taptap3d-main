// The picture on each TEMPLATE tile — built from the engine, not drawn by hand.
//
// ── THE TEMPTATION THIS FILE REFUSES ────────────────────────────────────────
//
// Three little SVGs: a 2×2 of squares for the catalogue, some stacked lines for
// the price list, one big square for the tearsheet. It is twenty minutes of
// work and it is A SECOND DRAWING OF A PAGE. The moment a margin moves, or a
// density gains a column, or a plate's share changes, the tile keeps promising
// the old shape — and the specialist finds out by pressing it and waiting for
// a re-render. ARCHITECTURE.md principle 6 is one renderer behind every output,
// and the predecessor is the reason it is written down.
//
// ── WHAT IT DOES INSTEAD, AND WHERE IT STOPS ────────────────────────────────
//
// It runs the REAL engine over the catalogue's own opening lots at the
// template's own default density, and turns page one into rectangles. So a tile
// is a picture of what pressing it would produce FOR THIS SALE — six rows and a
// thumbnail column, or one plate and a column of prose — rather than a generic
// icon of a grid. Change the engine and every tile changes with it, in the same
// commit, without anybody remembering to.
//
// It stops at BOXES. There is no type here, no photograph, no stylesheet and no
// colour: a tile is about 120px wide, where the difference between a title and
// a date is a fraction of a pixel, and inventing detail the eye cannot resolve
// at that size is precision for its own sake. The one distinction that survives
// the scale is the one that matters — is this a picture or is it words.
//
// ── WHAT IS MIRRORED FROM html.ts, AND WHY THAT IS SAFE ─────────────────────
//
// The engine emits a tree; the RENDERER turns it into boxes, in CSS. So unlike
// the predecessor — whose layout engine produced element frames this could read
// straight off — the geometry here has to be computed from the same numbers
// html.ts interpolates into its stylesheet. Most of them are the template's and
// are read from the same place. Four are literals in that stylesheet, named
// below as constants, and `test/template-preview.test.ts` READS html.ts and
// fails if any of them stops being the number in the rule it came from. That is
// the guard that makes this a mirror rather than a second opinion.
//
// Three things in that stylesheet are ABSOLUTE lengths — the 8px and 12px gaps
// inside a grid slot, the cell padding in a table, and the folio's 9px line —
// and an absolute length cannot be expressed as a fraction of a page whose
// pixel size is whatever the viewer's window is. They are left out. Each is
// under the area floor below at tile scale, so leaving them out changes no
// visible block; what it costs is that a tile is a hair looser than the page.

import {
  derive,
  units,
  type CatalogueParams,
  type DocSlot,
  type EngineLot,
} from "@/lib/engine/derive";
import {
  BUILT_IN_TEMPLATES,
  densityFor,
  placementFor,
  templateFor,
  type Arrangement,
  type Density,
  type Template,
} from "@/lib/engine/templates";

/**
 * One shape on a tile, in PAGE fractions — the same space the renderer's own
 * percentages resolve in, so a block is where the thing it stands for is.
 */
export interface ProxyBlock {
  x: number;
  y: number;
  w: number;
  h: number;
  kind: "plate" | "text";
}

export interface TemplateTile {
  id: string;
  name: { zh: string; en: string };
  /** One line for the person choosing: what this output is FOR. */
  purpose: string;
  arrangement: Arrangement;
  /** The density the tile was drawn at — the template's own default. */
  perPage: number;
  /** Width ÷ height of the SHEET, so the tile is the shape of the paper. */
  aspect: number;
  /**
   * The page diagram. EMPTY is a legitimate answer — a sale with no lots, or a
   * template the engine refused for this one — and the tile is still pickable.
   */
  blocks: ProxyBlock[];
}

// ── The numbers mirrored from src/lib/render/html.ts ────────────────────────
//
// Each is a literal in one rule of that stylesheet, and each is EXPORTED so
// that test/template-preview.test.ts can render a real document and assert the
// rule still says this number. That test is the difference between a mirror
// and a second opinion: change the gap in html.ts and it fails here, naming
// the rule, rather than the tiles quietly drifting from the page.

/** `.page--grid .grid { gap: 4% }` — between cells, both axes. */
export const GRID_GAP = 0.04;
/** `.page--sheet .slot { gap: 4% }` — between a sheet's plate and its caption. */
export const SHEET_GAP = 0.04;
/** `.page--sheet .slot--beside { gap: 5% }` — the same, side by side. */
export const SHEET_GAP_BESIDE = 0.05;
/** `.folio { margin-top: 3% }` — the strip the page number sits in. */
export const FOLIO_MARGIN = 0.03;

/**
 * Text rows drawn per entry.
 *
 * A caption may run to a dozen lines and the last of them are prose, which at
 * tile scale stack into one indistinguishable grey mass. The first few are the
 * ones that answer "where does the caption sit", which is the whole question a
 * tile is being asked, and stopping there bounds the work: a tile costs the
 * density times this, not the density times the field count.
 */
const MAX_TEXT_ROWS = 4;

/**
 * Blocks smaller than this fraction of the page are dropped.
 *
 * At a 120px tile, four ten-thousandths of the sheet is under a pixel: noise
 * that makes every tile slightly dirtier and tells nobody anything. Expressed
 * in AREA rather than in height, so a hairline running the width of a page —
 * which does say something about the page — survives it.
 */
const MIN_BLOCK_AREA = 0.0004;

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Add a block, CLAMPED TO THE PAPER and dropped if it is too small to see.
 *
 * Clamped because `.page` is `overflow: hidden` — that is the trim, and a
 * tile that painted outside its own rectangle would look like a rendering
 * fault rather than like a page.
 */
function push(blocks: ProxyBlock[], box: Box, kind: ProxyBlock["kind"]): void {
  const x = Math.max(0, box.x);
  const y = Math.max(0, box.y);
  const w = Math.min(1, box.x + box.w) - x;
  const h = Math.min(1, box.y + box.h) - y;
  if (w <= 0 || h <= 0 || w * h < MIN_BLOCK_AREA) return;
  blocks.push({ x, y, w, h, kind });
}

/**
 * How many lots a tile's page is built from.
 *
 * The density, capped at what the sale has — and WRAPPING rather than stopping
 * short, so a two-lot sale still gets a filled six-up tile. The tile is a
 * diagram of an ARRANGEMENT; repeating a lot inside it says nothing false about
 * the catalogue, whereas a page with four empty cells says the template leaves
 * them empty.
 */
export function lotsForTile(lots: EngineLot[], perPage: number): EngineLot[] {
  if (lots.length === 0) return [];
  const out: EngineLot[] = [];
  for (let i = 0; i < perPage; i++) out.push(lots[i % lots.length]!);
  return out;
}

/**
 * The caption's rows, inside the box the renderer gives it.
 *
 * ONE ROW PER LINE THE ENGINE DERIVED, capped. Height is the density's own line
 * box — `max-height: calc(1.45em * lines)` in the stylesheet means a line is a
 * `lines`-th of a full caption — and width is the line's own length against the
 * budget one line may spend, which is the density's `units` shared out over its
 * `lines`. Both numbers are the template's; neither is chosen here.
 *
 * It models the BOXES and not the TYPE. A tearsheet sets its title at 1.75em
 * and this does not know that, so a short title there draws shorter than it
 * prints. At 120px that is a pixel, and the alternative is this file learning
 * the stylesheet's type scale — which is the second renderer it exists to
 * avoid.
 */
function captionRows(
  blocks: ProxyBlock[],
  box: Box,
  slot: DocSlot,
  density: Density,
): void {
  const line = box.h / density.lines;
  const perLine = Math.max(1, density.units / density.lines);
  slot.caption.slice(0, MAX_TEXT_ROWS).forEach((entry, i) => {
    const filled = Math.min(1, units(entry.value) / perLine);
    push(blocks, { x: box.x, y: box.y + i * line, w: box.w * filled, h: line * 0.7 }, "text");
  });
}

/**
 * An entry's two parts, arranged as the template says.
 *
 * The plate takes its declared SHARE — of the box's height above the caption,
 * of its width beside it — which is `flex: 0 0 <share>` in the stylesheet, and
 * the caption takes the rest. A template with no plate at all gives the whole
 * box to the caption.
 *
 * THE PLATE BOX IS DRAWN WHETHER OR NOT THERE IS A PHOTOGRAPH IN IT, which is
 * the one place this parts company with the predecessor's page rail. There the
 * question was "is there a picture on this sheet", so an empty plate was
 * nothing; here the question is "what shape is this arrangement", and the
 * renderer paints an empty plate as a dashed box of exactly the same size.
 */
function entry(
  blocks: ProxyBlock[],
  box: Box,
  slot: DocSlot,
  template: Template,
  density: Density,
  beside: boolean,
  gap: number,
): void {
  const share = beside ? template.plate?.beside : template.plate?.above;
  if (share === undefined) {
    captionRows(blocks, box, slot, density);
    return;
  }
  if (beside) {
    const plateW = box.w * share;
    const gutter = box.w * gap;
    push(blocks, { ...box, w: plateW }, "plate");
    captionRows(
      blocks,
      { x: box.x + plateW + gutter, y: box.y, w: box.w - plateW - gutter, h: box.h },
      slot,
      density,
    );
    return;
  }
  const plateH = box.h * share;
  const gutter = box.h * gap;
  push(blocks, { ...box, h: plateH }, "plate");
  captionRows(
    blocks,
    { x: box.x, y: box.y + plateH + gutter, w: box.w, h: box.h - plateH - gutter },
    slot,
    density,
  );
}

/**
 * One tile per template, drawn from this sale's own opening lots.
 *
 * NO OVERRIDES AND NO PINS, deliberately. The tile answers "what does this
 * template do", and a frame somebody dragged in the current layout would leak
 * one lot's exception into a picture of a different arrangement — the tile
 * would show a box the template does not put there. A pin would move a lot to
 * page two and change which lots the tile is of.
 *
 * `params` is the catalogue's own, and only two of it are read: the placement,
 * resolved against each template so a tile shows where THAT template's plate
 * goes, and whether this catalogue prints a reference. The density is always
 * the template's default — the tile is an offer, and offering the catalogue at
 * whatever density the price list happened to be on would be a picture of
 * neither.
 */
export function templateTiles(input: {
  lots: EngineLot[];
  params: CatalogueParams;
  library?: readonly Template[];
}): TemplateTile[] {
  const library = input.library ?? BUILT_IN_TEMPLATES;
  return library.map((named) => {
    // Through `templateFor` rather than used directly, so a library holding
    // something the resolver would refuse cannot reach the engine from here.
    const template = templateFor(named.id, library);
    const density = densityFor(template, template.defaultPerPage);
    const portrait = template.page.orientation === "portrait";
    const aspect = portrait ? 210 / 297 : 297 / 210;
    const tile: TemplateTile = {
      id: template.id,
      name: template.name,
      purpose: template.purpose,
      arrangement: template.arrangement,
      perPage: density.perPage,
      aspect,
      blocks: [],
    };

    try {
      const doc = derive(
        lotsForTile(input.lots, density.perPage),
        {
          ...input.params,
          template: template.id,
          perPage: density.perPage,
          imagePlacement: placementFor(template, input.params.imagePlacement),
        },
        [],
        [],
        library,
      );
      const page = doc.pages[0];
      if (page) {
        tile.blocks = drawPage(page.slots, template, density, doc.columns, doc.params);
      }
    } catch {
      // A template the engine refuses for THIS sale — a page too small for its
      // margins, a library that disagrees with itself. The tile stays pickable
      // with no diagram rather than taking the editor down: the engine will
      // give the same refusal on the press, where a person can read it.
    }
    return tile;
  });
}

/** What `derive` hands back about a table's columns, as the tile reads it. */
interface Column {
  key: string;
  width: number;
}

function drawPage(
  slots: DocSlot[],
  template: Template,
  density: Density,
  columns: Column[],
  params: CatalogueParams,
): ProxyBlock[] {
  const blocks: ProxyBlock[] = [];
  const portrait = template.page.orientation === "portrait";
  const aspect = portrait ? 210 / 297 : 297 / 210;

  // ── The live area ─────────────────────────────────────────────────────────
  // `.live { padding: <margin>% }`. A PERCENTAGE PADDING RESOLVES AGAINST THE
  // CONTAINING BLOCK'S WIDTH on all four sides — top and bottom included — so
  // the vertical inset is the same share of the page's WIDTH, which in page
  // fractions is that share times the sheet's aspect. Getting this wrong is
  // the difference between a tile whose margins look square and one whose
  // margins are square.
  const m = template.page.margin / 100;
  const inset = { x: m, y: m * aspect };
  // The folio's own margin comes out of the body; its 9px line does not, for
  // the reason the header gives.
  const folio = FOLIO_MARGIN * (1 - 2 * inset.x) * aspect;
  const live: Box = {
    x: inset.x,
    y: inset.y,
    w: 1 - 2 * inset.x,
    h: 1 - 2 * inset.y - folio,
  };

  switch (template.arrangement) {
    case "grid": {
      // The renderer's own two lines: columns from the density, rows from how
      // many that leaves. Every slot on a page is the same box, which is what
      // a declared grid buys over a flow.
      const cols = density.columns ?? 1;
      const rows = Math.max(1, Math.ceil(density.perPage / cols));
      const gapX = live.w * GRID_GAP;
      const gapY = live.h * GRID_GAP;
      const cellW = (live.w - (cols - 1) * gapX) / cols;
      const cellH = (live.h - (rows - 1) * gapY) / rows;
      slots.forEach((slot, i) => {
        const cell: Box = {
          x: live.x + (i % cols) * (cellW + gapX),
          y: live.y + Math.floor(i / cols) * (cellH + gapY),
          w: cellW,
          h: cellH,
        };
        entry(blocks, cell, slot, template, density, params.imagePlacement === "beside", 0);
      });
      return blocks;
    }

    case "sheet": {
      const slot = slots[0];
      if (slot) {
        const beside = params.imagePlacement === "beside";
        entry(blocks, live, slot, template, density, beside, beside ? SHEET_GAP_BESIDE : SHEET_GAP);
      }
      return blocks;
    }

    case "table": {
      // `tr.slot { height: (100 / perPage)% }` of a table that is `height:
      // 100%` — so the declared rows want the whole body and the header takes
      // its content height on top, which the browser resolves by shrinking
      // them. One header's worth is one row's worth, so the body divides into
      // `perPage + 1` bands and the head is the first.
      const band = live.h / (density.perPage + 1);
      push(blocks, { ...live, h: band * 0.55 }, "text");
      slots.forEach((slot, row) => {
        const y = live.y + band * (row + 1);
        // The widths are the ENGINE'S — resolved in `tableColumns` from the
        // template's weights and emitted into a colgroup. The tile does not
        // divide anything.
        let x = live.x;
        const has = new Set(slot.caption.map((line) => line.key));
        for (const column of columns) {
          const w = live.w * column.width;
          if (column.key === "images") {
            push(blocks, { x, y, w, h: band * 0.75 }, "plate");
          } else if (column.key === "ref" ? slot.ref !== null : has.has(column.key)) {
            // A cell this row has nothing for is still a cell in the markup,
            // holding its column open — and it is blank, so there is nothing
            // to draw. That is the same distinction the renderer paints.
            push(blocks, { x, y, w: w * 0.85, h: band * 0.45 }, "text");
          }
          x += w;
        }
      });
      return blocks;
    }
  }
}
