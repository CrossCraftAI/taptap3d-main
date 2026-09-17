// The editor canvas's arithmetic — zoom, pan, which page you are on, where a
// floating toolbar may stand, and how to bring a box onto the glass.
//
// PORTED WHOLE from the predecessor's (editor)/projects/[id]/editor/canvas-geometry.ts
// (v0.2.2 session 4, E5) and WIRED IN PART. What tranche 1 reads is the
// page-tracking half — `currentPageIndex` and `pageScrollTop`, which put a
// reader back on the page they were on after the preview reloads with the
// server's answer. The zoom half describes a canvas that scales the frame
// with a CSS transform; this editor does not do that yet (its "fit" is a
// stored catalogue parameter the renderer honours by sizing the page — see
// CatalogueParams.fit), so at zoom = 1 the transform half is the identity and
// every screen constant divided by the zoom is unchanged. It is here, tested,
// so that the transform canvas arrives as a wiring change and not a rewrite,
// and so that the toolbar's placement rule — which has already been wrong in
// four photographed ways — does not have to be rediscovered.
//
// SEPARATE FROM THE COMPONENT for the reason drag-geometry.ts and
// selection-geometry.ts already state: vitest here runs in a node environment
// with no jsdom, so editor-canvas.tsx cannot be rendered in a test. A zoom that
// anchors to the wrong point, or a toolbar that stands on the artwork, does not
// throw — it just makes the screen feel wrong in front of a client. So every
// number a gesture produces is decided here and the component keeps the
// listeners and the paint.
//
// ── HOW ZOOM WORKS, AND WHY IT IS A TRANSFORM ────────────────────────────────
// The canvas scales the iframe with `transform: scale(z)`, it does NOT resize
// it. Two reasons, and both were checked against the predecessor's renderer
// rather than assumed:
//
//  1. Its screen mode's page box was `width: calc(100% - 32px); max-width:
//     210mm`. Widening the frame therefore stopped enlarging the page the
//     moment it reached physical A4 — a frame-width "zoom" could zoom OUT but
//     never in, which is the direction a specialist judging a plate needs.
//     This renderer's fit-page mode has the same property one axis over: the
//     page is sized by the frame's HEIGHT, so widening the frame does nothing.
//
//  2. A transform leaves the child's own coordinate space alone. Every rect the
//     overlay reads out of `contentDocument` stays in unscaled child pixels, so
//     the whole drag/resize/snap layer keeps working untouched and only the
//     quantities that are genuinely SCREEN distances — the snap threshold, the
//     nudge step, the drag threshold, the handle hit box — have to be divided by
//     the zoom. Resizing the frame would instead re-run CJK line breaking and
//     the fluid type scale on every zoom step, i.e. it would change the layout
//     being judged while you zoom into it.
//
// The frame keeps its own vertical scroll (the preview is one flow of every
// page), so the canvas only ever scrolls HORIZONTALLY, and only when a zoom
// takes the page wider than the viewport. Two scrollbars for one axis is the
// thing that makes a zoomed canvas feel broken.

import type { AnchorRect } from "./selection-geometry";

/**
 * How many sheets stand side by side when the canvas shows facing pages.
 *
 * The predecessor imported this from its spread-canvas module; spreads are a
 * later tranche and the number is the only thing this file needs from them.
 * Two, because a spread is two pages, which is not a decision anyone gets to
 * revisit.
 */
const SPREAD_COLUMNS = 2;

/**
 * The iframe's layout width, in CSS pixels, at every zoom level.
 *
 * 826 is not a taste: 210mm at the CSS reference 96dpi is 793.7px, and the
 * predecessor's screen mode gave the page 16px of air a side — 793.7 + 32 =
 * 825.7, so 826 is the narrowest frame at which the page reaches its cap. That
 * makes `zoom = 1` mean "A4 at life size on a 96dpi screen" rather than an
 * arbitrary number, and makes a 100% button honest. This renderer's fit-width
 * mode reaches the same size at the same frame width.
 */
export const FRAME_BASE_W = 826;

// ── WHAT THE TWO-PAGE CANVAS COST, MEASURED (predecessor UAT 14, part B) ─────
// The preview is ONE document holding every page in a vertical flow, so a
// spread on the glass is a LAYOUT question, not a second frame: pages side by
// side in a two-column grid. What it costs was measured, on the demo, through
// the live editor — the iframe ELEMENT resized to half, the CHILD's own
// computed values read back:
//
//     frame 826px → .page 793.7 × 1122.5, a caption title at 12.09px
//     frame 413px → .page 381.0 ×  538.8, the same title at  5.81px  (48%)
//
// Halving the column halves the type and re-runs CJK line breaking — which is
// the layout being judged. That is precisely why zoom is a TRANSFORM here and
// not a frame resize, and it is why two-up could not take the shortcut either:
// THE FRAME DOUBLES, to 1652, so each page still reaches 210mm.
//
// `zoom = 1` therefore means A4 at life size in one-up and a SPREAD at life
// size in two-up — which keeps the 100% button honest in both, because in both
// it is the arrangement on the glass at its physical size.

/**
 * The iframe's layout width, in CSS pixels, for the arrangement on the glass.
 *
 * One-up is FRAME_BASE_W. Two-up is twice it, and not one pixel less — see the
 * note above: a narrower column would shrink the type and re-break the lines,
 * which is the layout the specialist is judging.
 */
export function frameWidth(twoUp: boolean): number {
  return twoUp ? FRAME_BASE_W * SPREAD_COLUMNS : FRAME_BASE_W;
}

/** Bounds on the zoom. Below the floor a 43-page flow is unreadable; above the
 *  ceiling a single caption fills the screen and the specialist has lost the
 *  page they were judging. */
export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 4;

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));
}

/**
 * The zoom at which the ARRANGEMENT fills the canvas's width.
 *
 * `frame` is what makes fit-width answer the same question in both
 * arrangements: "show me everything the canvas is laid out to show, edge to
 * edge". In one-up that is a sheet; in two-up it is a spread, which is why the
 * toggle was pressed. It defaults to FRAME_BASE_W so a caller with no opinion
 * gets exactly the behaviour this function had before two-up existed.
 *
 * A degenerate width (the first render, before the ResizeObserver has measured
 * anything) yields 1 rather than 0 — a zoom of 0 would divide by itself in
 * anchoredScroll and put NaN into a scroll position, which the browser silently
 * ignores, leaving a canvas that cannot be scrolled and no error anywhere.
 */
export function fitZoom(canvasWidth: number, frame = FRAME_BASE_W): number {
  if (!Number.isFinite(canvasWidth) || canvasWidth <= 0) return 1;
  if (!Number.isFinite(frame) || frame <= 0) return 1;
  return clampZoom(canvasWidth / frame);
}

/**
 * Air above and below a page in the preview's own flow, in child pixels.
 *
 * `body { padding: 16px }` with `.page { margin: 0 auto 16px }` (this
 * renderer's stylesheet has the same rhythm the predecessor's had), and
 * pageScrollTop already parks a page 16px down from the top of the frame — so
 * a page occupies its own height plus this band at each end. Fit to the height
 * alone and the sheet lands edge-to-edge in the canvas with its shadow cut
 * off, which reads as a page still cropped rather than a page whole.
 */
const PAGE_AIR_PX = 16;

/**
 * The zoom at which a WHOLE PAGE is visible — width and height together.
 *
 * ── THE DEFECT THIS EXISTS FOR (predecessor session 16, #8) ─────────────────
 * Fit-width answers "read this flow", and on a 1440×900 screen it computes
 * 164%: correct for its own question, and it leaves under half a sheet on the
 * glass. A specialist judging a PAGE — is the plate too low, is the caption
 * crowding the foot, does this spread hold together — cannot answer any of it
 * while looking at a third of one, and the only way to see a whole page was to
 * press − four times and guess.
 *
 * So the height gets a control of its own rather than a smarter fit-width: the
 * two are different questions and a fit that silently switched between them
 * would move the paper under a specialist who had chosen one of them. (This
 * renderer already states the two apart as CatalogueParams.fit, and ROADMAP M1
 * carries the predecessor's defect that they once behaved identically.)
 *
 * NEVER WIDER THAN THE WIDTH FIT, which is what makes this a fit and not just a
 * different number: A4 is taller than it is wide and the canvas is wider than it
 * is tall, so the height is the binding constraint on every real screen — but a
 * short, very wide canvas would otherwise be handed a zoom whose page runs off
 * the sides. `min` of the two is the only answer that fits both axes.
 *
 * `pageHeight` is MEASURED off the loaded document, in child pixels, not derived
 * from pageSize millimetres: the page box's height depends on the frame as well
 * as the paper, and re-deriving it is the reconstruction this project keeps
 * refusing. A degenerate or absent measurement (the frame has not navigated
 * yet) falls back to the width fit, so the button always does SOMETHING
 * sensible rather than nothing.
 *
 * ── IN TWO-UP IT FITS THE WHOLE LEAF, AND THAT IS A DECISION ─────────────────
 * The question fit-page answers is 「can I judge this, whole」. In one-up the
 * unit being judged is a sheet. In two-up it is a SPREAD — that is the entire
 * reason the specialist pressed the toggle — so fitting one sheet of a two-up
 * canvas would put the facing page half off the glass, which is the state they
 * just pressed a button to leave. The arithmetic needs no branch for it:
 * `frame` makes byWidth the SPREAD's width fit, a spread is exactly as tall as
 * a page, and `min` of the two axes is the whole leaf.
 */
export function pageFitZoom(
  canvasWidth: number,
  canvasHeight: number,
  pageHeight: number,
  frame = FRAME_BASE_W,
  air = PAGE_AIR_PX,
): number {
  const byWidth = fitZoom(canvasWidth, frame);
  if (!Number.isFinite(pageHeight) || pageHeight <= 0) return byWidth;
  if (!Number.isFinite(canvasHeight) || canvasHeight <= 0) return byWidth;
  return clampZoom(Math.min(byWidth, canvasHeight / (pageHeight + 2 * air)));
}

/**
 * One ctrl/cmd+wheel notch.
 *
 * MULTIPLICATIVE, so a notch means the same proportional change at every zoom —
 * an additive step is either uselessly small at 4× or a leap at 0.3×. The 1/400
 * exponent is tuned so a mouse notch (deltaY ≈ 100) is about 22%, while a
 * trackpad pinch (deltaY of 2–10) stays smooth.
 */
export function wheelZoom(current: number, deltaY: number): number {
  if (!Number.isFinite(deltaY)) return clampZoom(current);
  return clampZoom(current * Math.exp(-deltaY / 400));
}

/** Where the two scrollers sit: the canvas horizontally, the frame vertically. */
export interface CanvasScroll {
  /** The canvas viewport's scrollLeft, in SCREEN pixels. */
  left: number;
  /** The preview document's scrollTop, in CHILD pixels. */
  top: number;
}

/**
 * The scroll positions that keep the point under the cursor under the cursor.
 *
 * A zoom that jumps to the top-left of the document is the difference between a
 * canvas and a picture viewer: the specialist zooms in ON something, and if the
 * something leaves the screen they have to go and find it again at every step.
 *
 * `cursor` is in CHILD pixels — i.e. straight off a wheel event raised inside
 * the preview, which is where the event is raised because the pointer is over an
 * iframe. The two axes are asymmetric because the two scrollers are: horizontal
 * scroll happens in the parent's scaled space, vertical scroll happens inside
 * the child at child scale.
 */
export function anchoredScroll(
  from: { zoom: number; left: number; top: number },
  toZoom: number,
  cursor: { x: number; y: number },
): CanvasScroll {
  if (from.zoom <= 0 || toZoom <= 0) return { left: from.left, top: from.top };
  // Horizontal: the cursor's screen offset inside the canvas is
  // (cursor.x * zoom - scrollLeft), and it must not change.
  const left = cursor.x * toZoom - (cursor.x * from.zoom - from.left);
  // Vertical: the cursor's screen offset is (cursor.y * zoom), which is fixed by
  // the same requirement, so the child coordinate under it becomes
  // cursor.y * from.zoom / toZoom and the document must scroll by the difference.
  const top = from.top + cursor.y - (cursor.y * from.zoom) / toZoom;
  return { left: Math.max(0, left), top: Math.max(0, top) };
}

/**
 * Fraction of the viewport's height above which a page counts as "the page you
 * are on". A third down: at the exact top edge a page list would flick to the
 * next page while its first line is still off screen, and at the middle a page
 * you have scrolled almost entirely past is still claimed as current.
 */
const PAGE_PICK = 0.35;

/**
 * Which page the reader is looking at, from the page tops and the scroll.
 *
 * `tops` are absolute offsets in the preview document (child pixels from the top
 * of the flow), not viewport-relative rects: they are measured once per loaded
 * document and never re-read on scroll, because a 43-page flow raises scroll
 * events continuously and re-measuring 43 boxes per frame to answer one small
 * question is exactly the kind of work that makes a preview stutter.
 *
 * IT TAKES TOPS AND NOTHING ELSE, which is exactly what it cannot answer in
 * two-up: two facing pages share a top, and this walk keeps the LAST index at or
 * above the line, i.e. the right-hand page. Deliberately not fixed here — a tie
 * rule would be a float comparison standing in for an arrangement the caller
 * already knows exactly. The spread canvas, when it lands, resolves the answer
 * to the leaf's first page.
 */
export function currentPageIndex(
  tops: readonly number[],
  scrollTop: number,
  viewportH: number,
): number {
  if (tops.length === 0) return 0;
  const line = scrollTop + viewportH * PAGE_PICK;
  let index = 0;
  for (let i = 0; i < tops.length; i++) {
    if (tops[i]! <= line) index = i;
    else break;
  }
  return index;
}

/** The child scrollTop that puts page `index` at the top of the frame. `pad` is
 *  the breathing room the renderer already draws above a page (body padding). */
export function pageScrollTop(
  tops: readonly number[],
  index: number,
  pad = 16,
): number {
  if (tops.length === 0) return 0;
  const i = Math.min(tops.length - 1, Math.max(0, index));
  return Math.max(0, tops[i]! - pad);
}

/** A rectangle's size in the parent's scaled space. */
export interface Size {
  w: number;
  h: number;
}

/**
 * Which side of the selection the bar chose, and why it is REPORTED rather than
 * inferred.
 *
 * The rule depends on the page's own contents, so "did it stand above or below,
 * and did it give up and pin itself?" cannot be recovered from a screenshot
 * without re-deriving the very arithmetic under test — the failure the
 * predecessor's audits paid for four times. The canvas publishes it as
 * `data-toolbar-side`.
 */
export type ToolbarSide = "above" | "below" | "pinned";

/** The canvas viewport as the toolbar sees it. */
export interface CanvasView {
  /** Visible size, in screen pixels. */
  w: number;
  h: number;
  /** How far the canvas has been panned, in screen pixels. */
  scrollLeft: number;
  /**
   * A band along the BOTTOM of the canvas that already belongs to something —
   * a zoom bar floating in the bottom-right corner, a selection readout.
   *
   * Found by photograph, not by reasoning: with the inspector open and a plate
   * selected at 302%, the toolbar took the "selection fills the view" branch,
   * pinned itself to the bottom edge, and landed exactly on top of the zoom
   * controls. Both were legible, neither was usable, and it is the kind of
   * collision that only appears when two independently-correct rules meet.
   *
   * Reserved for the whole WIDTH rather than the corner: a toolbar is centred on
   * its selection and the canvas pans, so "does this particular bar overlap that
   * particular corner" is a question whose answer changes as the specialist
   * scrolls. Lifting the bottom band costs a selection at the bottom-left a few
   * pixels of travel and cannot collide.
   */
  reserveBottom?: number;
}

/**
 * Where the floating toolbar stands, in the canvas's scaled-footprint
 * coordinates — or null when the selection is scrolled out of sight.
 *
 * THE RULE IS "NEVER ON THE ARTWORK" (E5: this is a client's unpublished sale,
 * and a bar sitting on a Zao Wou-Ki is worse than a bar in an awkward place).
 * So it is placed OUTSIDE the selection ring: above by preference, below when
 * there is no room above.
 *
 * ── WHAT "NO ROOM" HAD TO STOP MEANING (predecessor session 16, #13) ────────
 * It used to mean "off the top of the CANVAS", and that is the wrong page.
 * Selecting a thin caption row forty pixels down a sheet left plenty of canvas
 * above it — and the row above it was what the bar landed on. A bar whose entire
 * purpose is to keep controls off the artwork was covering content in order to
 * avoid covering content, and it did so on the most common selection there is.
 *
 * So the caller may hand in `clear`: where the nearest EMPTY BAND of page is on
 * each side of the selection, measured against the neighbouring painted boxes
 * (selection-geometry.ts's verticalClearance). The bar rises or drops PAST the
 * rows it would otherwise stand on and lands where it covers nothing.
 *
 * IT IS LAYERED OVER THE VIEWPORT RULE, never a replacement for it — a band that
 * is clear but off screen is no use — and when the page offers nowhere within
 * reach the bar goes back to standing beside its selection, because a bar on a
 * caption row beats a bar that has wandered away from the thing it acts on.
 *
 * ABSENT `clear` MEANS UNKNOWN and restores the old behaviour exactly (see
 * AnchorRect): the clearance arrives from a measured document, and a caller that
 * cannot measure one must not be told there is no room anywhere.
 *
 * The last case — a selection taller than the viewport, i.e. a full-bleed plate
 * at any real zoom — has no "outside" on screen at all. It is pinned to the
 * BOTTOM edge of the canvas rather than floated over the middle of the picture:
 * against the canvas edge it reads as chrome, which is what it is, and the
 * bottom of a plate is where a catalogue's own caption band sits.
 *
 * Returning null rather than clamping when the ring has scrolled away matters
 * for the same reason: a toolbar stuck to the top of the canvas, still offering
 * a reset for a lot forty pages up, is a control that has stopped pointing at
 * anything.
 */
export function toolbarSpot(
  rect: AnchorRect,
  zoom: number,
  view: CanvasView,
  toolbar: Size,
  gap = 10,
): { x: number; y: number; side: ToolbarSide } | null {
  const top = rect.y * zoom;
  const height = rect.h * zoom;
  const bottom = top + height;
  // Off the top or off the bottom of what the canvas shows. Against the REAL
  // viewport, not the reserved one: whether the selection is visible is a
  // question about the canvas, not about where a bar happens to fit.
  if (bottom < 0 || top > view.h) return null;

  // The lowest the bar may reach. See CanvasView.reserveBottom.
  const floor = view.h - (view.reserveBottom ?? 0);
  // The adjacent placements — where the bar went before any of this, and where
  // it still goes when the page has no opinion or no room anywhere.
  const above = top - gap - toolbar.h;
  const below = bottom + gap;
  // THE LIFT, in child pixels because that is the space the page was measured
  // in, scaled here into the screen pixels the toolbar lives in. Null means the
  // page offers nowhere on that side; 0 means the adjacent spot is already
  // clear, which is also what an ABSENT clearance means — so a caller that
  // cannot measure the page gets the old behaviour to the pixel.
  const liftAbove = rect.clear ? rect.clear.liftAbove : 0;
  const liftBelow = rect.clear ? rect.clear.liftBelow : 0;
  const clearAbove = liftAbove === null ? null : above - liftAbove * zoom;
  const clearBelow = liftBelow === null ? null : below + liftBelow * zoom;
  let y: number;
  let side: ToolbarSide;
  // THE SMALLER LIFT WINS, not "above by preference". Preference is what put the
  // bar on the row above a thin caption in the first place; the thing worth
  // preferring is nearness to the selection, and at equal nearness — both zero,
  // which is every uncrowded selection — the tie goes above exactly as before.
  const takeAbove =
    clearAbove !== null &&
    clearAbove >= 0 &&
    (clearBelow === null ||
      clearBelow + toolbar.h > floor ||
      (liftAbove ?? 0) <= (liftBelow ?? 0));
  if (takeAbove && clearAbove !== null) {
    y = clearAbove;
    side = "above";
  } else if (clearBelow !== null && clearBelow + toolbar.h <= floor) {
    y = clearBelow;
    side = "below";
  }
  // Nowhere on the page is both clear and on screen. Fall back to the adjacent
  // placement — a bar standing on a caption row beats a bar that has wandered
  // off the glass, and beats one pinned to the canvas edge while its selection
  // is in the middle of the sheet — and take the ROOMIER of the two, since
  // standing on a 12px gap beats standing on a 2px one. Equal (both zero, which
  // is a caption stack) keeps the old preference.
  else if (
    above >= 0 &&
    (below + toolbar.h > floor ||
      (rect.clear?.above ?? Infinity) >= (rect.clear?.below ?? Infinity))
  ) {
    y = above;
    side = "above";
  } else if (below + toolbar.h <= floor) {
    y = below;
    side = "below";
  } else if (above >= 0) {
    y = above;
    side = "above";
  } else {
    y = Math.max(0, floor - toolbar.h - gap);
    side = "pinned";
  }

  const centred = rect.x * zoom + (rect.w * zoom) / 2 - toolbar.w / 2;
  const lo = view.scrollLeft + gap;
  const hi = view.scrollLeft + view.w - toolbar.w - gap;
  // hi < lo when the toolbar is wider than the canvas; the left edge wins, so it
  // is the END of the row that overflows rather than the label that names the
  // selection.
  const x = hi < lo ? lo : Math.min(hi, Math.max(lo, centred));
  return { x, y, side };
}

/**
 * Glass kept around a box that has just been brought into view, in SCREEN px.
 *
 * Not zero, and not taste. The eight resize handles are painted CENTRED on the
 * ring's corners (the overlay's HANDLE_SIZE is 9, so 4.5px of every corner
 * handle hangs outside the box) and their hit box is larger still (HANDLE_HIT_PX
 * is 8, in screen pixels, on each side of the point). A box revealed flush to
 * the canvas edge therefore arrives with its corners half off the glass and the
 * other half unpressable, which is the same complaint this reveal exists to
 * answer. 24 clears the hit box on every side with room to aim.
 */
const REVEAL_PAD_PX = 24;

/** What it takes to put a box entirely on the glass. */
export interface RevealPlan {
  /** The zoom to use. Never larger than the current one — see revealPlan. */
  zoom: number;
  /** Change to apply to the PREVIEW DOCUMENT's scrollY, in child pixels. */
  scrollTopDelta: number;
  /** The canvas viewport's new scrollLeft, in screen pixels. */
  scrollLeft: number;
}

/**
 * Zoom and scroll so a box — and the handles drawn on it — are entirely visible.
 *
 * ── THE DEFECT THIS EXISTS FOR (predecessor UAT item 9) ──────────────────────
 * Fit-width was the canvas's default, and it answers "read this flow": on a
 * 1440×900 screen it computes 119%, at which an A4 sheet is 1337 screen pixels
 * tall against 852 of canvas. That is correct for reading and fatal for editing
 * a FULL-BLEED plate, because such a plate IS the sheet: entering subject-box
 * mode put the four bottom handles 485px below the bottom of the glass and the
 * three top ones exactly on its top edge. The gesture is not broken — six of
 * its eight grips are off screen, and nothing on the screen says so, which is
 * why it was filed as "cannot be dragged".
 *
 * ── WHY THIS AND NOT A SMARTER DEFAULT ZOOM ────────────────────────────────
 * Defaulting a full-bleed catalogue to fit-page was the alternative and it is
 * worse in both directions. It moves the paper for everybody who is READING a
 * full-bleed sale, to fix a gesture almost none of them are making; it leaves
 * the defect intact for the specialist who has deliberately pressed fit-width
 * and then wants to crop; and it does nothing at all for the other ways a box
 * grows past the canvas. Reveal-on-enter is the rule every editor uses when it
 * opens a crop, it fires only on the gesture that needs it, and it is a
 * function of the box rather than of the placement.
 *
 * NEVER MAGNIFIES. `zoom` is a ceiling, not a target: bringing a small caption
 * into view must not blow it up to fill the canvas, because the specialist
 * chose this zoom to judge the page and a mode that silently re-scales the paper
 * is the thing fit-page's own note refuses. It only ever pulls back far enough
 * to fit, and returns the zoom unchanged when the box already fits.
 */
export function revealPlan(
  rect: { x: number; y: number; w: number; h: number },
  view: { w: number; h: number },
  zoom: number,
  /** The arrangement's footprint — see frameWidth. Only the horizontal clamp
   *  reads it: a box on the RIGHT-hand page of a spread is past 826 in child
   *  pixels, so a scrollLeft capped at the one-up footprint would stop short of
   *  it and the reveal would land the plate half off the glass. */
  frame = FRAME_BASE_W,
  pad = REVEAL_PAD_PX,
): RevealPlan {
  const current = clampZoom(zoom);
  const still: RevealPlan = { zoom: current, scrollTopDelta: 0, scrollLeft: 0 };
  if (!(view.w > 0) || !(view.h > 0)) return still;
  if (!Number.isFinite(rect.x) || !Number.isFinite(rect.y)) return still;

  // Each axis constrains the zoom only when it has a box to measure AND room
  // left after the padding. A canvas smaller than the padding is not a canvas to
  // fit anything into, and letting it drive the zoom would floor it at ZOOM_MIN
  // and throw the specialist out to a 25% page for no gain.
  const roomW = view.w - 2 * pad;
  const roomH = view.h - 2 * pad;
  let next = current;
  if (rect.w > 0 && roomW > 0) next = Math.min(next, roomW / rect.w);
  if (rect.h > 0 && roomH > 0) next = Math.min(next, roomH / rect.h);
  const z = clampZoom(next);

  // Centre the box on both axes. Centring rather than "scroll the minimum" is
  // deliberate: after the reveal the specialist DRAGS the box, and a box that
  // arrives just inside the edge is one whose next gesture leaves the glass.
  //
  // Vertical is a DELTA because `rect` is viewport-relative while the scroller
  // is the child document — and the box's absolute position in that document
  // does not change with the zoom, so the caller can add this to whatever
  // scrollY it has without this function needing to know it.
  const scrollTopDelta = rect.y + rect.h / 2 - view.h / z / 2;
  // Horizontal happens in the parent's scaled space, where the footprint is
  // `frame` × z wide. Clamped to what can actually be scrolled: a negative
  // scrollLeft is ignored by the browser, and one past the end would leave the
  // canvas showing grey beside the page.
  const span = Math.max(0, frame * z - view.w);
  const wanted = (rect.x + rect.w / 2) * z - view.w / 2;
  return {
    zoom: z,
    scrollTopDelta,
    scrollLeft: Math.min(span, Math.max(0, wanted)),
  };
}
