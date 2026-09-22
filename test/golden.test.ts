// The bytes, pinned. Four whole documents, on disk, openable in a browser.
//
// A golden here holds the ENTIRE string `renderCatalogue` returns — markup and
// stylesheet together — because the stylesheet is where the house's greys and
// hairlines live, and any projection shaped like markup would be structurally
// blind to them. That is the defect this test exists for. Nothing between the
// renderer and the string can reorder an attribute or re-indent a rule: it is
// concatenation of template literals, so the usual case against whole-string
// goldens — that a serialiser's whims become the assertion — does not apply.
//
// Plain `.html` rather than a vitest snapshot so that a golden OPENS, and the
// review diff is the diff of a web page. Regenerate with:
//
//     UPDATE_GOLDEN=1 npx vitest run test/golden.test.ts
//
// then read `git diff test/golden`. That diff IS the change; the failure
// message below only says where to look, because vitest's diff of a twenty-
// kilobyte document is a wall nobody reads. Refused when CI is set: a golden
// that rewrites itself on the build machine is a green build with no test in it.
//
// WHAT IS PINNED IS THE PREVIEW'S BYTES. The PDF is the same function called
// with a different asset resolver, and html.ts's header names that as the one
// thing the two outputs disagree about — a `data:` URI where the preview has
// `/api/assets/<hash>`. A golden cannot claim the two are byte-identical,
// because by design at one leaf they are not.
//
// ── WHY FOUR, AND IT IS NOT FOR COLOUR ──────────────────────────────────────
//
// An earlier plan for this test said the goldens were partitioned by colour —
// that `.page--table .placed.ref` is a rule a grid-only golden would leave
// unguarded. It is not. The `<style>` block in html.ts is emitted WHOLE for
// every document: every hole in it is a number, and not one rule is gated on
// the arrangement. The catalogue golden below contains the table's placed-part
// colours and the sheet's leading verbatim, and one golden therefore guards
// every colour byte in the file. The palette census further down proves this
// rather than asserting it, by reading the same inventory out of all four.
//
// This is written here because the next person deciding which golden is safe to
// drop will reach for that reasoning, and it would tell them the wrong thing.
//
// What actually differs between two documents is MARKUP and PAGE GEOMETRY, so
// those are the axes, one golden each:
//
//   catalogue-grid        cells two across, and a placed part that follows its
//                         lot onto page two rather than staying on page one
//   price-list-table      a colgroup, a header, a filler row, and a cell lifted
//                         out of the ledger with its empty <td> left behind
//   tearsheet-sheet       a page as a description list, labels, pre-line prose
//   wall-label-landscape  A4 the other way up
//
// THE LAST ONE IS THE ONE THAT NEARLY WAS NOT HERE, and it is the only one with
// a press bill attached. All three built-ins are portrait, so a set built from
// them alone pins `@page { size: A4 }` four times over and never reaches
// html.ts's landscape arm — the branch whose own comment records what it
// prevents: every page overflowing onto a second, blank one, eleven pages
// printing as twenty-two. `templateSchema` has admitted `landscape` since it was
// written and `derive` takes the library as an argument, so a house can author
// one today with no change to any of this. Partitioning by arrangement alone
// would have tripled the axis that carries no risk and missed the one that does.
//
// ── NOT NORMALISED, IN EITHER DIRECTION ─────────────────────────────────────
//
// The compare strips nothing, and `test/golden/*.html` is pinned `-text` in
// .gitattributes so that git converts nothing either. Both halves are
// deliberate, and they were nearly the other way round.
//
// A CR CANNOT REACH THE OUTPUT FROM THE SOURCE. It was proposed to normalise
// \r\n on both sides of the compare, against a fresh Windows clone checking
// html.ts out with CRLF. That cannot happen: ECMA-262 normalises <CR><LF>
// inside a template literal to <LF> at parse time, and esbuild — which is what
// vitest transforms .ts with — does the same at build time. Rendering the same
// document from a CRLF copy of html.ts and from an LF one gives the same bytes,
// measured, not reasoned about.
//
// A CR CAN REACH IT FROM THE DATA, AND THAT IS THE ONE WORTH CATCHING.
// `escapeHtml` handles & < > " ' and nothing else, and nothing in the engine
// strips control characters, so a description imported from a Windows-authored
// CSV arrives in the document with its CRLF intact — and on a tearsheet, where
// `.value` is `white-space: pre-line`, that is a visible line break in the
// deliverable. Lot d carries one for exactly this reason. Normalising would
// have aimed the test's one bespoke defence at a defect that cannot occur while
// blinding it to the only instance of that character that can.
//
// THE PIN IS ON THE GOLDENS, NOT ON THE RENDERER. `test/templates.test.ts` is
// `w/crlf` in this very working tree — `* text=auto` plus Windows — so a golden
// committed as LF comes back from the next checkout as CRLF and the compare
// fails on its first line. `-text` rather than `text eol=lf`, because a golden
// is a byte fixture in both directions and `eol=lf` would rewrite lot d's CRLF
// out of the index, deleting the coverage the previous paragraph is about.
// Nothing pins html.ts, because nothing needs to.
//
// ── THE FIXTURE IS THIS FILE'S OWN ──────────────────────────────────────────
//
// It resembles test/templates.test.ts's SALE and is deliberately not imported
// from it. A golden whose input lives in another test file is a golden that
// turns red when somebody adds a sixth lot to prove an unrelated point about
// pagination, and four unreadable diffs later nobody trusts the file. The cost
// is one duplicated fixture.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  DEFAULT_PARAMS,
  derive,
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
  templateSchema,
  type Template,
  type TemplateInput,
} from "@/lib/engine/templates";
import { renderCatalogue } from "@/lib/render/html";

const GOLDEN_DIR = path.join(import.meta.dirname, "golden");
const UPDATE = process.env.UPDATE_GOLDEN === "1";

if (UPDATE && process.env.CI) {
  throw new Error(
    "UPDATE_GOLDEN is refused under CI. A golden that regenerates itself on the " +
      "build machine is a green build with no test in it.",
  );
}

// ── The fixture ─────────────────────────────────────────────────────────────

const PROSE =
  "此作為趙無極晚期重要油畫，展現其成熟的抽象風格，色層厚重而筆觸奔放。".repeat(8);

/** A description as a Windows-authored CSV delivers it. See the header. */
const IMPORTED = "入藏於一九七二年。\r\n原為高氏家族舊藏，未曾公開展出。";

const SALE: EngineLot[] = [
  {
    id: "a",
    ref: "P01",
    fields: {
      title: "青花纏枝蓮紋梅瓶",
      maker: "佚名",
      date: "清乾隆",
      material: "瓷",
      dimensions: "高 32.5 cm",
      price: "800,000 – 1,200,000 HKD",
      description: "器形端莊，釉色瑩潤。",
      // A column the house keeps and no template names: it prints where `*` is.
      品相: "全品",
    },
    images: ["plate-a"],
  },
  {
    id: "b",
    ref: "P02",
    // Long enough to be cut at a grid's budget and to print whole on a sheet.
    fields: { title: "山水四屏", maker: "張大千", price: "3,500,000 – 4,800,000 HKD", description: PROSE },
    images: ["plate-b"],
  },
  {
    // No maker and no photograph, deliberately: a table still owes this row
    // every cell, and a grid still owes it the empty-plate box.
    id: "c",
    ref: "P03",
    fields: { title: "白玉雕螭龍紋佩", price: "180,000 – 260,000 HKD", 來源: "香港私人收藏" },
    images: [],
  },
  {
    id: "d",
    ref: "P04",
    fields: { title: "墨荷", maker: "齊白石", date: "1950", price: "400,000 – 600,000 HKD", description: IMPORTED },
    images: [],
  },
  {
    // The fifth lot is the first lot of page two at four-up.
    id: "e",
    ref: "P05",
    fields: { title: "紫砂壺", maker: "顧景舟", date: "約 1960", material: "紫砂", price: "200,000 – 300,000 HKD" },
    images: ["plate-e"],
  },
];

/**
 * What a specialist has done to this sale.
 *
 * WITHOUT THESE THE GOLDENS WOULD MISS THE NEWEST CODE IN THE FILE. A fixture
 * with no overrides paints no `placedAt`, no `data-frame-source`, no `.placed`
 * rule and never takes the lifted-`<td>` branch — which is precisely the part
 * of html.ts that changed at HEAD and the part with no other byte-level test.
 */
const CORRECTIONS: EngineOverride[] = [
  // A CORRECTION AND A PLACEMENT ON ONE KEY, which is the whole of what "a
  // correction is a patch" means where it is visible: lot b's estimate prints
  // the corrected words, in the box a person drew for it. One row, two
  // judgements, and placing the part must not erase the typo fix.
  { lotId: "b", field: "price", text: "估價待詢", frame: { x: 0.62, y: 0.08, w: 0.3, h: 0.06 } },
  // A plate a person moved. In a table this is the lifted plate cell.
  { lotId: "a", field: "images", frame: { x: 0.08, y: 0.55, w: 0.34, h: 0.28 } },
  // A reference a person moved: the kit swaps to neutral tags, so on a sheet
  // whose caption is a <dl> this comes out as a <div>, not a stray <dt>.
  { lotId: "c", field: "ref", frame: { x: 0.7, y: 0.9, w: 0.22, h: 0.04 } },
  // On the fifth lot, so the grid must emit this onto page TWO. A placed part
  // is gathered per page while that page's entries are built; a part collected
  // globally would print on page one, above a lot that is not there.
  { lotId: "e", field: "title", frame: { x: 0.1, y: 0.12, w: 0.5, h: 0.08 } },
  // A field this catalogue leaves off. In a price list that is an EMPTY maker
  // cell and not a missing one, which is a different code path from lot c's
  // absent maker and is worth having both in the bytes.
  { lotId: "d", field: "maker", hidden: true },
];

/**
 * A house-authored template, landscape. Not a built-in and deliberately so:
 * the orientation branch is reachable only through the library argument, and
 * the day a house authors one this is the document they get.
 */
const WALL_LABEL: Template = templateSchema.parse({
  id: "wall-label",
  name: { zh: "展牆標籤", en: "Wall label" },
  purpose: "Six labels across a landscape sheet, the accession number last.",
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
} satisfies TemplateInput);

const LIBRARY: readonly Template[] = [...BUILT_IN_TEMPLATES, WALL_LABEL];

interface Golden {
  file: string;
  template: Template;
}

const GOLDENS: readonly Golden[] = [
  { file: "catalogue-grid.html", template: CATALOGUE },
  { file: "price-list-table.html", template: PRICE_LIST },
  { file: "tearsheet-sheet.html", template: TEARSHEET },
  { file: "wall-label-landscape.html", template: WALL_LABEL },
];

/** Each template at its own default density — the document a house gets first. */
const on = (template: Template): CatalogueParams => ({
  ...DEFAULT_PARAMS,
  template: template.id,
  perPage: template.defaultPerPage,
});

const documentFor = (golden: Golden): CatalogueDocument =>
  derive(SALE, on(golden.template), [], CORRECTIONS, LIBRARY);

const renderOf = (golden: Golden): string => renderCatalogue(documentFor(golden));

// ── Reading and writing them ────────────────────────────────────────────────

const pathOf = (file: string): string => path.join(GOLDEN_DIR, file);

/**
 * A MISSING GOLDEN IS A FAILURE, not an invitation to create one. Writing it on
 * demand would make deleting a golden a way to make this file pass, which is the
 * one outcome a golden must not have.
 */
function readGolden(file: string): string {
  const at = pathOf(file);
  if (!existsSync(at)) {
    throw new Error(
      `${file} is missing. Regenerate deliberately: ` +
        `UPDATE_GOLDEN=1 npx vitest run test/golden.test.ts`,
    );
  }
  return readFileSync(at, "utf8");
}

if (UPDATE) {
  mkdirSync(GOLDEN_DIR, { recursive: true });
  // Node writes the string it is given, so LF stays LF and lot d's CRLF stays
  // CRLF. The `-text` pin is what keeps that true through a checkout.
  for (const golden of GOLDENS) writeFileSync(pathOf(golden.file), renderOf(golden), "utf8");
}

/**
 * "" when the two strings are the same byte for byte, and otherwise the first
 * place they part.
 *
 * A NAME FOR THE PLACE, NOT THE DIFFERENCE. The readable diff already exists —
 * regenerate and `git diff test/golden`, which a review renders as a web page —
 * so this points at the byte and gets out of the way. JSON.stringify on the
 * window is what makes a stray CR visible as `\r` instead of as nothing at all.
 */
function firstDifference(rendered: string, golden: string): string {
  if (rendered === golden) return "";
  let at = 0;
  while (at < rendered.length && at < golden.length && rendered[at] === golden[at]) at += 1;
  const line = golden.slice(0, at).split("\n").length;
  const window = (text: string): string =>
    JSON.stringify(text.slice(Math.max(0, at - 40), at + 60));
  return (
    `diverges at byte ${at}, line ${line}\n` +
    `  golden:   ${window(golden)}\n` +
    `  rendered: ${window(rendered)}\n` +
    `  to see the change: UPDATE_GOLDEN=1 npx vitest run test/golden.test.ts && git diff test/golden`
  );
}

describe("the document is the bytes on disk", () => {
  it.each(GOLDENS.map((g) => [g.file, g] as const))("%s", (_file, golden) => {
    expect(firstDifference(renderOf(golden), readGolden(golden.file))).toBe("");
  });
});

// ── The named claims ────────────────────────────────────────────────────────
//
// These catch little the byte compare above does not, and they are here so that
// the person about to delete this file, or one golden out of it, reads what
// they are deleting — a byte compare says "these bytes" and nothing about which
// facts those bytes were holding.
//
// THEY READ THE FILE, NOT THE RENDER, and that is the one place they outlive
// the compare. Every failure above is answered by regenerating, and a claim
// asserted against the renderer would regenerate along with it. Asserted
// against the golden, it survives the update command and fires on the way
// through — measured: painting the folio in a brand blue and then accepting it
// with UPDATE_GOLDEN=1 leaves the byte compare green and this file still red,
// naming the hue.

/**
 * Every colour literal a document mentions, deduplicated, in code-unit order.
 *
 * CASE-INSENSITIVE, and that flag is not tidiness. `#1F6FEB` is how a hex
 * arrives from a design tool, and without the `i` it was invisible to this
 * census while the byte compare caught it — meaning the failure would have
 * named a line number instead of naming the colour, and would have gone away
 * under UPDATE_GOLDEN=1, which is the single thing this census exists to stop.
 *
 * Every colour FUNCTION CSS has, not only rgb: hsl, hwb, lab, lch, oklab,
 * oklch, color, color-mix. The renderer writes hex today, so all but two of
 * these match nothing — they are here because the first one somebody reaches
 * for is whichever one this list forgot.
 *
 * Known hole: NAMED colours. `white`, `crimson` and the other 147 are ordinary
 * words and cannot be told from prose by a regex over a whole document. The
 * byte compare still catches them; this census would not name them.
 */
const COLOUR =
  /#[0-9a-f]{3,8}\b|(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color-mix|color)\([^)]*\)/gi;
const palette = (html: string): string[] => [...new Set(html.match(COLOUR) ?? [])].sort();

/**
 * The house's greys, whole.
 *
 * ARCHITECTURE.md principle 4 puts taste at runtime per house (ROADMAP D1) and
 * calls these the developer's neutral defaults until then, so the claim worth
 * holding is that the set is CLOSED and NEUTRAL: nothing here is a hue, and a
 * brand colour arriving in the renderer is a decision, not a tweak.
 */
const HOUSE_GREYS = [
  "#1b1b1b",
  "#3a3a3a",
  "#5a5a5a",
  "#6e6e6e",
  "#8a8a8a",
  "#a8a8a8",
  "#b4b4b4",
  "#dcdcdc",
  "#e0e0e0",
  "#f6f6f6",
  "#fafafa",
  "#fcfcfc",
  "#fff",
  "rgba(0,0,0,.06)",
  "rgba(0,0,0,.10)",
  "rgba(255,255,255,0)",
];

it("every document carries the same closed palette of house greys", () => {
  for (const golden of GOLDENS) {
    expect(palette(readGolden(golden.file))).toEqual(HOUSE_GREYS);
  }
  // AND THIS IS THE PROOF OF THE HEADER'S CLAIM. Four arrangements, two
  // orientations, one inventory — because the stylesheet is emitted whole
  // whatever the document is. Any single golden guards every colour byte, so
  // the other three are here for markup and geometry and for nothing else.
  expect(readGolden("catalogue-grid.html")).toContain(".page--table .placed.ref {");
  expect(readGolden("catalogue-grid.html")).toContain(".page--sheet .placed { line-height: 1.5; }");
});

/** Every (lot, field) the document paints, with how many times. */
function painted(html: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const [, lotId, field] of html.matchAll(/ data-lot="([^"]*)" data-field="([^"]*)"/g)) {
    const key = `${lotId}/${field}`;
    out.set(key, (out.get(key) ?? 0) + 1);
  }
  return out;
}

/**
 * Every (lot, field) the ENGINE said this document holds.
 *
 * A grid and a sheet paint the lines this lot has, plus its plate box whether
 * or not there is a photograph in it, plus its reference where the template
 * names one. A table paints every column for every row, because a row missing a
 * cell shifts the columns after it.
 */
function derived(doc: CatalogueDocument): string[] {
  const out = new Set<string>();
  const namesRef = doc.template.fields.some((f) => f.key === "ref");
  for (const page of doc.pages) {
    for (const slot of page.slots) {
      if (doc.template.arrangement === "table") {
        for (const column of doc.columns) out.add(`${slot.lotId}/${column.key}`);
        continue;
      }
      if (namesRef && slot.ref !== null) out.add(`${slot.lotId}/ref`);
      out.add(`${slot.lotId}/images`);
      for (const line of slot.caption) out.add(`${slot.lotId}/${line.key}`);
    }
  }
  return [...out].sort();
}

/** The table cells a person lifted: content moved, the `<td>` left behind. */
function lifted(doc: CatalogueDocument): string[] {
  if (doc.template.arrangement !== "table") return [];
  return doc.pages
    .flatMap((page) => page.slots)
    .flatMap((slot) =>
      doc.columns.filter((c) => slot.frames?.[c.key]).map((c) => `${slot.lotId}/${c.key}`),
    )
    .sort();
}

/**
 * THE GOLDEN ON ONE SIDE, THE LIVE ENGINE ON THE OTHER, which is what makes
 * this the assertion that NAMES a dropped field rather than locating one. The
 * byte compare says the document parted from the file at byte 17749; this says
 * `a/品相` — measured, by putting an off-by-one in `choose` and reading both
 * failures.
 */
describe("every field the engine derived is painted, and nothing else is", () => {
  it.each(GOLDENS.map((g) => [g.file, g] as const))("%s", (file, golden) => {
    const doc = documentFor(golden);
    const marks = painted(readGolden(file));
    expect([...marks.keys()].sort()).toEqual(derived(doc));
    // ONCE EACH, with one exception that is a decision rather than a slip: a
    // lifted table cell is painted twice, because the content goes onto the page
    // and the empty `<td>` stays in the ledger holding its column open.
    const twice = [...marks].filter(([, n]) => n > 1).map(([key]) => key).sort();
    expect(twice).toEqual(lifted(doc));
  });
});

/**
 * What each golden is in the set FOR, as a substring and the files that have it.
 *
 * Equality, not containment, on the file list. That is the point: it fails when
 * a golden stops covering its axis AND when the last golden covering an axis is
 * deleted, and the failure names the axis rather than handing over a diff.
 */
const AXES: readonly { axis: string; mark: string; files: string[] }[] = [
  { axis: "a grid of cells", mark: '<div class="grid">', files: ["catalogue-grid.html", "wall-label-landscape.html"] },
  { axis: "a table of rows under a header", mark: "<thead>", files: ["price-list-table.html"] },
  { axis: "a short page keeping its row height", mark: '<tr class="filler"', files: ["price-list-table.html"] },
  { axis: "a page as a description list", mark: '<dl class="caption">', files: ["tearsheet-sheet.html"] },
  { axis: "a label printed before its value", mark: ' labelled"', files: ["tearsheet-sheet.html", "wall-label-landscape.html"] },
  { axis: "the house's own column, where `*` puts it", mark: 'data-field="品相"', files: ["catalogue-grid.html", "tearsheet-sheet.html"] },
  { axis: "a part a person placed", mark: 'data-frame-source="override"', files: ["catalogue-grid.html", "price-list-table.html", "tearsheet-sheet.html", "wall-label-landscape.html"] },
  { axis: "a lifted cell leaving its empty <td> behind", mark: 'data-field="price"></td>', files: ["price-list-table.html"] },
  { axis: "A4 portrait", mark: "size: A4;", files: ["catalogue-grid.html", "price-list-table.html", "tearsheet-sheet.html"] },
  { axis: "A4 landscape", mark: "size: A4 landscape;", files: ["wall-label-landscape.html"] },
  { axis: "a CR that arrived in the data", mark: "\r\n", files: ["catalogue-grid.html", "tearsheet-sheet.html"] },
];

it.each(AXES.map((a) => [a.axis, a] as const))("the set still covers: %s", (_axis, { mark, files }) => {
  const has = GOLDENS.filter((g) => readGolden(g.file).includes(mark)).map((g) => g.file);
  expect(has).toEqual(files);
});
