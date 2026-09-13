// The renderer. One implementation, behind every output.
//
// Today it paints the preview. The PDF and the listing are later consumers of
// this same function, which is the point: a second renderer is how a preview
// stops resembling the deliverable, and the predecessor ended up with two of
// them (ARCHITECTURE.md principle 6).
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

import type { CatalogueDocument, DocSlot } from "@/lib/engine/derive";

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

function plate(slot: DocSlot): string {
  if (!slot.image) {
    return '<div class="plate plate--empty"><span>no photograph</span></div>';
  }
  return `<div class="plate"><img src="/api/assets/${escapeHtml(slot.image)}" alt=""></div>`;
}

function caption(slot: DocSlot): string {
  const ref = slot.ref
    ? `<p class="ref">${escapeHtml(slot.ref)}</p>`
    : "";
  const lines = slot.caption
    .map(
      (line) =>
        `<p class="line line--${escapeHtml(line.key)}">` +
        `<span class="label">${escapeHtml(line.label)}</span>` +
        `<span class="value">${escapeHtml(line.value)}</span></p>`,
    )
    .join("");
  return `<div class="caption">${ref}${lines}</div>`;
}

/**
 * Paint a document.
 *
 * Returns a complete HTML document, styles inlined. Inlined because the frame's
 * CSP permits no external stylesheet, and because a print deliverable that
 * depends on a second request is a print deliverable that sometimes arrives
 * unstyled.
 */
export function renderCatalogue(doc: CatalogueDocument): string {
  // A real catalogue grid, not a flow. Rows AND columns are declared so every
  // slot on a page is the same box — two plates that differ in height by the
  // length of the caption under them is the thing a specialist notices first.
  const GRID: Record<number, [number, number]> = {
    1: [1, 1],
    2: [1, 2],
    4: [2, 2],
    6: [2, 3],
    9: [3, 3],
  };
  const [columns, rows] = GRID[doc.params.perPage] ?? [2, 2];
  // How many lines of description a slot can hold at this density.
  //
  // DELIBERATELY CONSERVATIVE. The clamp cuts at a line boundary; the caption box
  // around it cuts wherever it happens to end — so a count larger than the box
  // can hold produces a sliver of half-height glyphs along the bottom edge,
  // which is what production showed at two-up. Under-filling costs a line of
  // description; over-filling costs the page's credibility.
  //
  // Provisional numbers, and knowingly so: the honest version measures the
  // painted boxes from the parent, which is the editor overlay's job and lands
  // with it.
  const DESCRIPTION_LINES: Record<number, number> = { 1: 10, 2: 5, 4: 3, 6: 2, 9: 1 };
  const descriptionLines = DESCRIPTION_LINES[doc.params.perPage] ?? 3;
  // The description's lines plus the ref, title, maker, date, material,
  // dimensions and price that can precede it.
  const captionLines = descriptionLines + 7;
  const beside = doc.params.imagePlacement === "beside";
  // FIT PAGE sizes by height so a whole page is in the frame; FIT WIDTH sizes by
  // width and lets the page run past the fold. They are genuinely different at
  // every density — the predecessor's two controls collapsed into the same
  // behaviour at two-up, which is why one of them looked broken.
  const pageSize =
    doc.params.fit === "width"
      ? "width: 100%; height: auto;"
      : "height: calc(100vh - 32px); width: auto;";

  const pages = doc.pages
    .map(
      (page) =>
        `<section class="page" data-page="${page.number}">` +
        `<div class="grid">` +
        page.slots
          .map(
            (slot) =>
              `<article class="slot${beside ? " slot--beside" : ""}">` +
              plate(slot) +
              caption(slot) +
              `</article>`,
          )
          .join("") +
        `</div>` +
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
<title>Catalogue preview</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 16px; background: #f6f6f6;
    font-family: "Noto Serif TC", "Songti TC", Georgia, "Times New Roman", serif;
    color: #1b1b1b;
  }
  /* SIZED BY HEIGHT, so a WHOLE PAGE is in the frame. A preview scaled to the
     frame's width puts two thirds of an A4 page below the fold, and a
     specialist judging whether a spread is balanced cannot judge a third of it.
     Scrolling then moves page to page, which is how the deliverable is read. */
  .page {
    background: #fff; aspect-ratio: 210 / 297; ${pageSize}
    max-width: 100%; margin: 0 auto 16px; padding: 5%;
    box-shadow: 0 1px 2px rgba(0,0,0,.10), 0 6px 20px rgba(0,0,0,.06);
    display: flex; flex-direction: column;
  }
  .page--empty { aspect-ratio: auto; height: auto; width: auto; padding: 48px; text-align: center; color: #6e6e6e; }
  .grid {
    flex: 1; min-height: 0; display: grid; gap: 4%;
    grid-template-columns: repeat(${columns}, minmax(0, 1fr));
    grid-template-rows: repeat(${rows}, minmax(0, 1fr));
  }
  .slot { display: flex; flex-direction: column; gap: 8px; min-height: 0; min-width: 0; }
  /* A FIXED SHARE OF THE SLOT, not flex:1. With flex the plate absorbs
     whatever the caption leaves, so a lot with a long description gets a
     smaller photograph than the lot beside it — which is exactly the ragged
     baseline a printed catalogue exists to avoid. */
  .plate {
    flex: 0 0 62%; min-height: 0; display: flex; align-items: center;
    justify-content: center; background: #fafafa; overflow: hidden;
  }
  .plate img { max-width: 100%; max-height: 100%; object-fit: contain; display: block; }
  .plate--empty {
    border: 1px dashed #dcdcdc; background: #fcfcfc;
    font: 10px/1.4 system-ui, sans-serif; color: #b4b4b4; letter-spacing: .04em;
  }
  .slot--beside { flex-direction: row; align-items: stretch; gap: 12px; }
  .slot--beside .plate { flex: 0 0 44%; }
  .slot--beside .caption { flex: 1; min-width: 0; }
  /* CONTAINED. This was overflow:visible, on the argument that a caption too
     long for its slot is a defect and hiding it would make the future defect
     gate blind. Production said otherwise: a 90-character provenance note ran
     straight down through the plate of the lot beneath it, and three overlapping
     lots is not a more honest page than a truncated one — it is an unreadable
     one. The long-form field is clamped with an ellipsis, which is a visible
     mark rather than a silent cut, and the rest is contained. */
  .caption {
    flex: 1; min-height: 0; overflow: hidden;
    font-size: clamp(7px, 1.1vh, 12px); line-height: 1.45;
    /* A whole number of line boxes, so the container's own clip lands between
       lines instead of through one. */
    max-height: calc(1.45em * ${captionLines});
  }
  .ref {
    margin: 0 0 3px; font-family: system-ui, sans-serif; font-weight: 600;
    font-size: .82em; letter-spacing: .1em; color: #8a8a8a;
  }
  .line { margin: 0 0 1px; }
  .line .label { display: none; }
  .line--title .value { font-weight: 600; font-size: 1.12em; }
  .line--maker .value { color: #3a3a3a; }
  .line--price .value { font-variant-numeric: tabular-nums; letter-spacing: .01em; }
  /* The description is the only long-form field and the only one clamped. The
     line count follows the density, because how much room a caption has is a
     function of how many lots share the page — and the ellipsis is what tells a
     person the text continues. */
  .line--description .value {
    color: #5a5a5a; display: -webkit-box; -webkit-box-orient: vertical;
    -webkit-line-clamp: ${descriptionLines}; overflow: hidden;
  }
  .value { overflow-wrap: anywhere; }
  .folio {
    margin-top: 3%; text-align: center;
    font: 9px/1 system-ui, sans-serif; color: #a8a8a8; letter-spacing: .12em;
  }
  @media print {
    body { background: #fff; padding: 0; }
    .page { box-shadow: none; margin: 0; height: 297mm; width: 210mm; max-width: none; break-after: page; }
  }
</style>
</head>
<body>${pages}${empty}</body>
</html>`;
}
