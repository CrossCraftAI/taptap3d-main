// The renderer. One implementation, behind every output.
//
// Today it paints the preview and the PDF. The listing is a later consumer of
// this same function, which is the point: a second renderer is how a preview
// stops resembling the deliverable, and the predecessor ended up with two of
// them (ARCHITECTURE.md principle 6).
//
// ── ONE RENDERER, THREE ARRANGEMENTS, NOT THREE RENDERERS ───────────────────
//
// A catalogue is a grid of cells, a price list is a table of rows, a tearsheet
// is a page. They are painted by THIS function from THIS stylesheet: the
// template in the document says which arrangement, and two small switches below
// — how a page wraps its entries, how an entry wraps its three parts — are the
// whole of the difference. Every number the switches interpolate comes from the
// document's template; nothing about a layout is decided here. The moment a
// template needs a fourth switch, that is a fourth arrangement of the same
// entry, added here, and not a screen of its own.
//
// What stays in this file, deliberately, is what is neither structure nor a
// layout fact: the fonts, the greys, the hairlines, the gap rhythm. That is a
// house's TASTE, and ARCHITECTURE.md principle 4 says taste is learned per
// house at runtime (ROADMAP D1) rather than encoded in a rule shipped to
// everyone. Until D1, these are the developer's neutral defaults and they are
// the same for every template so that a template is judged on its shape.
//
// ── THE FRAME IS INERT BECAUSE OF THE CSP, NOT BECAUSE OF A SANDBOX ──────────
//
// The document below carries `default-src 'none'` as THE FIRST TAG IN <head>,
// and declares no `script-src`, so scripts fall back to `none` and do not run.
// The frame that displays it must NOT carry a `sandbox` attribute.
//
// This is not pedantry and it is not preference. WebKit dispatches no DOM events
// at all into a frame sandboxed without `allow-scripts` — so with a sandbox, the
// entire editing layer is dead in Safari while Chromium-only testing reports
// everything green. That cost the predecessor a year. The sandbox bought nothing
// the CSP did not already provide, and took the product with it.
//
// `img-src 'self'` is the one relaxation, because a catalogue without plates is
// not a catalogue. It permits same-origin images only, which is `/api/assets/…`
// — already org-scoped by the route that serves it.

import type { CaptionLine, CatalogueDocument, DocPage, DocSlot } from "@/lib/engine/derive";

/**
 * How a plate's content hash becomes something the document can load.
 *
 * THE ONE THING THE PREVIEW AND THE PDF DISAGREE ABOUT, and it is a leaf rather
 * than a branch. The preview points at `/api/assets/<hash>`, which is
 * same-origin and org-scoped by the route that serves it. The PDF has no origin
 * and no session — it is painted by a headless browser from a string — so it
 * carries its plates inline as `data:` URIs, which the document's own policy
 * already permits.
 *
 * Keeping the difference here is what "one renderer behind every output" means
 * in practice: two consumers resolve an asset reference differently and paint
 * identically.
 */
export type AssetResolver = (contentHash: string) => string;

const byRoute: AssetResolver = (hash) => `/api/assets/${hash}`;

/** Escape for text and attribute positions alike. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export const PREVIEW_CSP =
  "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'";

/** A share as a CSS percentage: 0.62 → "62%". */
const pct = (share: number | undefined): string =>
  share === undefined ? "0%" : `${Math.round(share * 1000) / 10}%`;

function plate(slot: DocSlot, asset: AssetResolver): string {
  if (!slot.image) {
    return '<div class="plate plate--empty"><span>no photograph</span></div>';
  }
  return `<div class="plate"><img src="${escapeHtml(asset(slot.image))}" alt=""></div>`;
}

/**
 * The tags an arrangement uses for a caption's parts. A grid's caption is
 * paragraphs; a sheet's is a description list, because a museum label IS a list
 * of an object's properties and the markup may as well say so.
 */
interface CaptionKit {
  line: "p" | "div";
  label: "span" | "dt";
  value: "span" | "dd";
}
const PARAGRAPHS: CaptionKit = { line: "p", label: "span", value: "span" };
const DESCRIPTION_LIST: CaptionKit = { line: "div", label: "dt", value: "dd" };

/**
 * A caption's inside: the lines in print order, with the reference where the
 * template's fields put it.
 *
 * The reference is not a caption line — it is the slot's own, never budgeted —
 * so it is placed here by comparing positions in the template's `fields`: it
 * goes before the first line whose field comes after it. A catalogue names it
 * first, so it leads; a museum label names it last, so it closes.
 *
 * A line carries `labelled` when its field asked for its name to print, or, for
 * one of the house's own columns, when `*` did. The label is IN THE MARKUP
 * either way and the stylesheet decides — so a template change is a class
 * change and never a re-derivation.
 */
function captionInner(doc: CatalogueDocument, slot: DocSlot, kit: CaptionKit): string {
  const fields = doc.template.fields;
  const refAt = fields.findIndex((f) => f.key === "ref");
  const starAt = fields.findIndex((f) => f.key === "*");
  const placeOf = (key: string): number => {
    const at = fields.findIndex((f) => f.key === key);
    return at >= 0 ? at : starAt >= 0 ? starAt : fields.length;
  };
  const labelled = (key: string): boolean =>
    fields[placeOf(key)]?.label ?? false;

  const ref = slot.ref === null ? "" : `<${kit.line} class="ref">${escapeHtml(slot.ref)}</${kit.line}>`;
  const line = (l: CaptionLine): string =>
    `<${kit.line} class="line line--${escapeHtml(l.key)}${labelled(l.key) ? " labelled" : ""}">` +
    `<${kit.label} class="label">${escapeHtml(l.label)}</${kit.label}>` +
    `<${kit.value} class="value">${escapeHtml(l.value)}</${kit.value}></${kit.line}>`;

  let refPending = ref !== "" && refAt >= 0;
  const parts: string[] = [];
  for (const l of slot.caption) {
    if (refPending && placeOf(l.key) > refAt) {
      parts.push(ref);
      refPending = false;
    }
    parts.push(line(l));
  }
  if (refPending) parts.push(ref);
  return parts.join("");
}

/** One entry — a lot on a page — arranged as the template says. */
function entry(doc: CatalogueDocument, slot: DocSlot, asset: AssetResolver): string {
  const beside = doc.params.imagePlacement === "beside";
  switch (doc.template.arrangement) {
    case "grid":
      return (
        `<article class="slot${beside ? " slot--beside" : ""}">` +
        plate(slot, asset) +
        `<div class="caption">${captionInner(doc, slot, PARAGRAPHS)}</div>` +
        `</article>`
      );
    case "sheet":
      return (
        `<article class="slot slot--sheet${beside ? " slot--beside" : ""}">` +
        plate(slot, asset) +
        `<dl class="caption">${captionInner(doc, slot, DESCRIPTION_LIST)}</dl>` +
        `</article>`
      );
    case "table": {
      // Every row has every column. A cell this lot has nothing for is still a
      // cell, or the eye running down the estimate column lands on a maker.
      const byKey = new Map(slot.caption.map((l) => [l.key, l]));
      const cells = doc.columns.map((column) => {
        if (column.key === "ref") {
          return `<td class="ref">${slot.ref === null ? "" : escapeHtml(slot.ref)}</td>`;
        }
        if (column.key === "images") {
          const img = slot.image
            ? `<img src="${escapeHtml(asset(slot.image))}" alt="">`
            : "";
          return `<td class="plate"><div class="cell">${img}</div></td>`;
        }
        const l = byKey.get(column.key);
        return (
          `<td class="line line--${escapeHtml(column.key)}"><div class="cell">` +
          (l ? `<span class="value">${escapeHtml(l.value)}</span>` : "") +
          `</div></td>`
        );
      });
      return `<tr class="slot">${cells.join("")}</tr>`;
    }
  }
}

/** A page's body: its entries, wrapped as the arrangement needs. */
function pageBody(doc: CatalogueDocument, page: DocPage, asset: AssetResolver): string {
  const entries = page.slots.map((slot) => entry(doc, slot, asset)).join("");
  switch (doc.template.arrangement) {
    case "grid":
      return `<div class="grid">${entries}</div>`;
    case "sheet":
      return entries;
    case "table": {
      const cols = doc.columns
        .map((c) => `<col style="width: ${pct(c.width)}">`)
        .join("");
      const head = doc.columns
        .map((c) => {
          const cls = c.key === "ref" ? "ref" : c.key === "images" ? "plate" : `line line--${escapeHtml(c.key)}`;
          return `<th class="${cls}">${escapeHtml(c.label)}</th>`;
        })
        .join("");
      // A short last page keeps its row height: one auto row takes what the
      // missing rows would have, so twenty rows and three rows are the same
      // ledger and not a three-row table stretched to the foot of the page.
      const filler =
        page.slots.length < doc.density.perPage
          ? `<tr class="filler" aria-hidden="true"><td colspan="${doc.columns.length}"></td></tr>`
          : "";
      return (
        `<div class="body"><table>` +
        `<colgroup>${cols}</colgroup>` +
        `<thead><tr>${head}</tr></thead>` +
        `<tbody>${entries}${filler}</tbody>` +
        `</table></div>`
      );
    }
  }
}

/**
 * Paint a document.
 *
 * Returns a complete HTML document, styles inlined. Inlined because the frame's
 * CSP permits no external stylesheet, and because a print deliverable that
 * depends on a second request is a print deliverable that sometimes arrives
 * unstyled.
 */
export function renderCatalogue(
  doc: CatalogueDocument,
  options: { asset?: AssetResolver } = {},
): string {
  const asset = options.asset ?? byRoute;
  const { template, density } = doc;

  // ── Page geometry, from the template ──────────────────────────────────────
  const portrait = template.page.orientation === "portrait";
  const [pageWidth, pageHeight] = portrait ? ["210mm", "297mm"] : ["297mm", "210mm"];
  const aspect = portrait ? "210 / 297" : "297 / 210";
  const pageSheet = portrait ? "A4" : "A4 landscape";
  // FIT PAGE sizes by height so a whole page is in the frame; FIT WIDTH sizes by
  // width and lets the page run past the fold. They are genuinely different at
  // every density — the predecessor's two controls collapsed into the same
  // behaviour at two-up, which is why one of them looked broken.
  const pageSize =
    doc.params.fit === "width"
      ? "width: 100%; height: auto;"
      : "height: calc(100vh - 32px); width: auto;";
  // A percentage of the page's HEIGHT on screen, capped where it prints. The
  // floor is a legibility floor for a small preview and belongs to the screen,
  // not to the template.
  const bodyType = `clamp(7px, ${template.type.body}vh, ${template.type.cap}px)`;

  // ── The grid's cells ──────────────────────────────────────────────────────
  // A real catalogue grid, not a flow. Rows AND columns are declared so every
  // slot on a page is the same box — two plates that differ in height by the
  // length of the caption under them is the thing a specialist notices first.
  const columns = density.columns ?? 1;
  const rows = Math.max(1, Math.ceil(density.perPage / columns));

  const pages = doc.pages
    .map(
      (page) =>
        `<section class="page page--${template.arrangement}" data-page="${page.number}">` +
        pageBody(doc, page, asset) +
        `<footer class="folio">${page.number}</footer>` +
        `</section>`,
    )
    .join("");

  const empty =
    doc.pages.length === 0
      ? '<section class="page page--empty"><p>This catalogue has no lots yet.</p></section>'
      : "";

  return `<!doctype html>
<html lang="zh-Hant">
<head>
<meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(template.name.en)} preview</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 16px; background: #f6f6f6;
    /* HK BEFORE TC, AND THAT IS A DOMAIN DECISION RATHER THAN A PREFERENCE.
       Noto Serif CJK ships separate HK and TC faces because Hong Kong and
       Taiwan standardise different glyph forms for the same characters, and the
       first customers are Hong Kong houses printing Hong Kong catalogues. Both
       are in the image; naming HK first is the difference between a catalogue
       that looks locally typeset and one that looks imported.

       The container's faces come first, then a specialist's own machine, then
       Latin. "Noto Sans CJK HK" is the last CJK rung on purpose: a sans
       catalogue is a compromise, and tofu is a reprint. */
    font-family: "Noto Serif CJK HK", "Noto Serif CJK TC", "Noto Serif TC",
      "Source Han Serif TC", "Songti TC", "Noto Sans CJK HK", Georgia,
      "Times New Roman", serif;
    color: #1b1b1b;
  }
  /* SIZED BY HEIGHT, so a WHOLE PAGE is in the frame. A preview scaled to the
     frame's width puts two thirds of an A4 page below the fold, and a
     specialist judging whether a spread is balanced cannot judge a third of it.
     Scrolling then moves page to page, which is how the deliverable is read.
     The margin is the template's, as a share of the page's width. */
  .page {
    background: #fff; aspect-ratio: ${aspect}; ${pageSize}
    max-width: 100%; margin: 0 auto 16px; padding: ${template.page.margin}%;
    box-shadow: 0 1px 2px rgba(0,0,0,.10), 0 6px 20px rgba(0,0,0,.06);
    display: flex; flex-direction: column;
  }
  .page--empty { aspect-ratio: auto; height: auto; width: auto; padding: 48px; text-align: center; color: #6e6e6e; }
  .folio {
    margin-top: 3%; text-align: center;
    font: 9px/1 system-ui, sans-serif; color: #a8a8a8; letter-spacing: .12em;
  }
  .value { overflow-wrap: anywhere; }

  /* ── GRID: cells ─────────────────────────────────────────────────────────
     Scoped to the arrangement, because a rule for .slot that means a flex
     column would break a table row of the same name. */
  .page--grid .grid {
    flex: 1; min-height: 0; display: grid; gap: 4%;
    grid-template-columns: repeat(${columns}, minmax(0, 1fr));
    grid-template-rows: repeat(${rows}, minmax(0, 1fr));
  }
  .page--grid .slot { display: flex; flex-direction: column; gap: 8px; min-height: 0; min-width: 0; }
  /* A FIXED SHARE OF THE SLOT, not flex:1. With flex the plate absorbs
     whatever the caption leaves, so a lot with a long description gets a
     smaller photograph than the lot beside it — which is exactly the ragged
     baseline a printed catalogue exists to avoid. The share is the template's. */
  .page--grid .plate {
    flex: 0 0 ${pct(template.plate?.above)}; min-height: 0; display: flex; align-items: center;
    justify-content: center; background: #fafafa; overflow: hidden;
  }
  .page--grid .plate img { max-width: 100%; max-height: 100%; object-fit: contain; display: block; }
  .page--grid .plate--empty {
    border: 1px dashed #dcdcdc; background: #fcfcfc;
    font: 10px/1.4 system-ui, sans-serif; color: #b4b4b4; letter-spacing: .04em;
  }
  .page--grid .slot--beside { flex-direction: row; align-items: stretch; gap: 12px; }
  .page--grid .slot--beside .plate { flex: 0 0 ${pct(template.plate?.beside)}; }
  .page--grid .slot--beside .caption { flex: 1; min-width: 0; }
  /* CONTAINED. This was overflow:visible, on the argument that a caption too
     long for its slot is a defect and hiding it would make the future defect
     gate blind. Production said otherwise: a 90-character provenance note ran
     straight down through the plate of the lot beneath it, and three overlapping
     lots is not a more honest page than a truncated one — it is an unreadable
     one. The long-form field is clamped with an ellipsis, which is a visible
     mark rather than a silent cut, and the rest is contained. The ceiling on
     the caption box, in line boxes, is the density's; the engine already bounds
     what goes into a caption and this is the last resort that keeps a
     pathological value off the lot beneath it. */
  .page--grid .caption {
    flex: 1; min-height: 0; overflow: hidden; position: relative;
    font-size: ${bodyType}; line-height: 1.45;
    max-height: calc(1.45em * ${density.lines});
  }
  /* THE CUT IS A FADE, NOT A GUILLOTINE.
     How many lines precede the description varies per lot — a work with no maker
     and no date has two more lines of room than the one beside it — so no fixed
     clamp fits every slot, and where it does not the box clips through the
     middle of a glyph. Measuring the painted boxes is the honest answer and it
     belongs to the editor overlay, which reads the preview from the parent.
     Until then this: the last line fades into the page, which reads as "there is
     more" instead of as a rendering fault. On a caption that does not fill its
     box the gradient lies over blank paper and is invisible. */
  .page--grid .caption::after {
    content: ""; position: absolute; left: 0; right: 0; bottom: 0;
    height: 1.5em; pointer-events: none;
    background: linear-gradient(to bottom, rgba(255,255,255,0) 0%, #fff 85%);
  }
  .page--grid .ref {
    margin: 0 0 3px; font-family: system-ui, sans-serif; font-weight: 600;
    font-size: .82em; letter-spacing: .1em; color: #8a8a8a;
  }
  .page--grid .line { margin: 0 0 1px; }
  .page--grid .line .label { display: none; }
  .page--grid .line.labelled .label { display: inline; margin-right: .5em; font-size: .85em; color: #8a8a8a; letter-spacing: .04em; }
  .page--grid .line--title .value { font-weight: 600; font-size: 1.12em; }
  .page--grid .line--maker .value { color: #3a3a3a; }
  .page--grid .line--price .value { font-variant-numeric: tabular-nums; letter-spacing: .01em; }
  /* NO CLAMP HERE ANY MORE. It was keyed to the description class and never
     fired on real data: the predecessor's long prose arrives under a column the
     house calls notes, which prints as a custom field and matched no rule. Any
     field can be long, so the bound moved into the engine, where it is
     field-agnostic, derived, and does not depend on a browser honouring a
     prefixed property.

     (And no backticks in here: this stylesheet lives inside a template literal,
     so one in a comment ends the string mid-rule. That has now cost two
     debugging sessions.) */
  .page--grid .line--description .value { color: #5a5a5a; }

  /* ── TABLE: rows under a header ──────────────────────────────────────────
     A real table element, because a price list is one and the markup should
     say so to a screen reader and to the next person. Fixed layout with the
     template's column shares, so the columns line up down the page whatever
     the row above holds. */
  .page--table .body { flex: 1; min-height: 0; overflow: hidden; }
  .page--table table {
    width: 100%; height: 100%; border-collapse: collapse; table-layout: fixed;
    font-size: ${bodyType}; line-height: 1.35;
  }
  .page--table th {
    text-align: left; vertical-align: bottom; padding: 0 .7em .55em 0;
    font-family: system-ui, sans-serif; font-weight: 600; font-size: .78em;
    letter-spacing: .1em; color: #6e6e6e; border-bottom: 1px solid #1b1b1b;
  }
  /* EVERY ROW THE SAME HEIGHT, the density's share of the table. A row's text
     is already bounded by the engine to the column's units and to this many
     lines; the cell is the last resort that keeps a row from growing into the
     one beneath it and pushing the last row off the page in silence. */
  .page--table tr.slot { height: ${(100 / density.perPage).toFixed(3)}%; }
  .page--table td {
    padding: .3em .7em .3em 0; vertical-align: top;
    border-bottom: 1px solid #e0e0e0;
  }
  .page--table th:last-child, .page--table td:last-child { padding-right: 0; }
  .page--table .cell { max-height: calc(1.35em * ${density.lines}); overflow: hidden; }
  /* A REFERENCE STAYS IN ITS COLUMN. The first screenshot of a price list had
     a sixteen-character reference running straight across the thumbnail into
     the title, because nowrap without containment is an invitation. A house
     reference is usually P01, but any field can be long — so it is cut at the
     column edge WITH AN ELLIPSIS, a visible mark, rather than wrapped mid-code
     or allowed out. The column's width is the template's to widen. */
  .page--table td.ref, .page--table th.ref { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .page--table td.ref {
    font-family: system-ui, sans-serif; font-weight: 600; font-size: .82em;
    letter-spacing: .1em; color: #8a8a8a; padding-top: .45em;
  }
  .page--table td.plate .cell {
    height: calc(1.35em * ${density.lines}); display: flex; align-items: center;
  }
  .page--table td.plate img { max-width: 100%; max-height: 100%; object-fit: contain; display: block; }
  .page--table td.line--title .value { font-weight: 600; }
  .page--table td.line--maker .value { color: #3a3a3a; }
  .page--table th.line--price, .page--table td.line--price { text-align: right; }
  .page--table td.line--price .value { font-variant-numeric: tabular-nums; letter-spacing: .01em; }
  .page--table tr.filler td { border-bottom: 0; padding: 0; }

  /* ── SHEET: a page ───────────────────────────────────────────────────────
     One entry, the plate dominant, the caption a description list with the
     specifications labelled and the prose keeping its paragraphs. */
  .page--sheet .slot { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 4%; }
  .page--sheet .slot--beside { flex-direction: row; align-items: stretch; gap: 5%; }
  .page--sheet .plate {
    flex: 0 0 ${pct(template.plate?.above)}; min-height: 0; display: flex; align-items: center;
    justify-content: center; background: #fafafa; overflow: hidden;
  }
  .page--sheet .slot--beside .plate { flex: 0 0 ${pct(template.plate?.beside)}; }
  .page--sheet .plate img { max-width: 100%; max-height: 100%; object-fit: contain; display: block; }
  .page--sheet .plate--empty {
    border: 1px dashed #dcdcdc; background: #fcfcfc;
    font: 11px/1.4 system-ui, sans-serif; color: #b4b4b4; letter-spacing: .04em;
  }
  .page--sheet .caption {
    flex: 1; min-height: 0; min-width: 0; margin: 0; overflow: hidden; position: relative;
    font-size: ${bodyType}; line-height: 1.5;
    max-height: calc(1.5em * ${density.lines});
  }
  .page--sheet .caption::after {
    content: ""; position: absolute; left: 0; right: 0; bottom: 0;
    height: 1.5em; pointer-events: none;
    background: linear-gradient(to bottom, rgba(255,255,255,0) 0%, #fff 85%);
  }
  .page--sheet .ref {
    margin: 0 0 .7em; font-family: system-ui, sans-serif; font-weight: 600;
    font-size: .78em; letter-spacing: .14em; color: #8a8a8a;
  }
  .page--sheet .line { display: flex; gap: 1.2em; margin: 0 0 .3em; }
  .page--sheet .label { display: none; }
  .page--sheet .labelled .label {
    display: block; flex: 0 0 4.5em; margin: 0; padding-top: .14em;
    font-size: .82em; letter-spacing: .06em; color: #8a8a8a;
  }
  .page--sheet .value { flex: 1; min-width: 0; margin: 0; white-space: pre-line; }
  .page--sheet .line--title { margin: 0 0 .4em; }
  .page--sheet .line--title .value { font-weight: 600; font-size: 1.75em; line-height: 1.2; }
  .page--sheet .line--maker .value { font-size: 1.15em; color: #3a3a3a; }
  .page--sheet .line--date .value { color: #5a5a5a; }
  .page--sheet .line--price .value { font-variant-numeric: tabular-nums; }
  .page--sheet .line--description { margin-top: 1em; }
  .page--sheet .line--description .value { color: #3a3a3a; }

  @media print {
    /* MARGIN ZERO, and the page's own padding is the margin. Without this the
       browser adds its default half-inch outside a box that is already exactly
       A4, and every page overflows onto a second, blank one — eleven pages
       become twenty-two. The sheet's orientation is the template's. */
    @page { size: ${pageSheet}; margin: 0; }
    body { background: #fff; padding: 0; }
    .page {
      box-shadow: none; margin: 0; break-after: page;
      height: ${pageHeight}; width: ${pageWidth}; max-width: none;
    }
    .page:last-child { break-after: auto; }
    /* NO FADE ON PAPER. A gradient at the foot of a caption tells a reader on a
       screen that the text continues. A printed page has no "continues", so the
       same gradient reads as a smear — as though the press ran out of ink. The
       engine's caption budget is what keeps the text inside the box; this makes
       sure nothing pretends otherwise. */
    .caption::after { display: none; }
  }
</style>
</head>
<body>${pages}${empty}</body>
</html>`;
}
