// The editor's drag, resize and snapping arithmetic.
//
// PORTED from the predecessor's (editor)/projects/[id]/editor/drag-geometry.ts
// (v0.2.2 session 3, E2), reasoning included. Two imports changed and nothing
// else: the turned box's bounds come from ./rotation.ts rather than the
// predecessor's core barrel, and `committable` is now the same predicate the
// server refuses with (src/lib/engine/frame.ts) rather than a copy of it.
//
// SEPARATE FROM THE COMPONENT for the reason selection-geometry.ts states and
// this file needs twice as badly: vitest here runs in a node environment with no
// jsdom, so selection-overlay.tsx cannot be rendered in a test at all. A drag
// that is wrong by a slot width does not throw and does not fail a structural
// check — it moves a client's artwork somewhere nobody asked for, and the only
// witness is the printed catalogue. So every decision a gesture makes lives here
// as a pure function over plain rectangles, and the component keeps only the
// listeners and the paint.
//
// EVERYTHING HERE IS IN OVERLAY PIXELS except toPageFrame/fromPageFrame, which
// are the boundary. That boundary is the one piece worth naming twice: an
// override records a frame in PAGE fractions (a placed element can leave its
// slot, so slot coordinates would stop meaning anything), while every
// rectangle the browser hands us is CSS pixels relative to the overlay layer.
// The conversion is two divisions and it is the single place a silent error
// would be indistinguishable from a correct edit.

import { intersectsPage, type OverrideFrame } from "@/lib/engine/frame";

import { rotatedBounds } from "./rotation";
import type { OverlayRect, Point } from "./selection-geometry";

// ── Modes and handles ────────────────────────────────────────────────────────

/**
 * The eight resize handles, plus "move".
 *
 * Named by compass point because that is what the cursor names are (`nwse-resize`)
 * and because a handle's identity IS which edges it moves — `ne` moves top and
 * right, and the code below reads exactly that off the string.
 */
export const RESIZE_HANDLES = [
  "nw",
  "n",
  "ne",
  "e",
  "se",
  "s",
  "sw",
  "w",
] as const;
export type ResizeHandle = (typeof RESIZE_HANDLES)[number];
export type DragMode = "move" | ResizeHandle;

/** The CSS cursor for each handle. */
export const HANDLE_CURSOR: Record<ResizeHandle, string> = {
  nw: "nwse-resize",
  n: "ns-resize",
  ne: "nesw-resize",
  e: "ew-resize",
  se: "nwse-resize",
  s: "ns-resize",
  sw: "nesw-resize",
  w: "ew-resize",
};

/**
 * Smallest box a drag may leave behind, in overlay pixels.
 *
 * Not taste: an element resized to nothing is one that can never be selected
 * again — there is no handle left to grab and no box left to click — so the
 * specialist's only recovery would be the reset, which they cannot reach without
 * selecting it first. A floor of 8px is under 3mm on the preview and still
 * grabbable.
 */
export const MIN_SIZE_PX = 8;

/** Where a handle sits on a frame. */
export function handlePoint(rect: OverlayRect, handle: ResizeHandle): Point {
  const midX = rect.x + rect.w / 2;
  const midY = rect.y + rect.h / 2;
  const right = rect.x + rect.w;
  const bottom = rect.y + rect.h;
  switch (handle) {
    case "nw":
      return { x: rect.x, y: rect.y };
    case "n":
      return { x: midX, y: rect.y };
    case "ne":
      return { x: right, y: rect.y };
    case "e":
      return { x: right, y: midY };
    case "se":
      return { x: right, y: bottom };
    case "s":
      return { x: midX, y: bottom };
    case "sw":
      return { x: rect.x, y: bottom };
    case "w":
      return { x: rect.x, y: midY };
  }
}

/**
 * Which handle a pointer landed on, or null.
 *
 * HIT-TESTED HERE rather than by giving the painted handles `pointer-events:
 * auto`, and that is a deliberate repeat of the overlay's rule 3. The overlay
 * layer is inert so the preview keeps its own scrolling — every page in one
 * vertical flow — and eight live 10px squares would each be a small dead zone
 * where the wheel scrolls the app instead of the catalogue. The parent already
 * receives every pointer event through the child document, in child-viewport
 * coordinates that convert to overlay coordinates with the same origin offset
 * the rings use, so nothing is lost by testing them ourselves.
 *
 * Corners are tested BEFORE edges: at a corner the two hit boxes overlap, and a
 * human aiming at the corner of a picture means the corner.
 */
export function hitHandle(
  rect: OverlayRect,
  point: Point,
  radius: number,
): ResizeHandle | null {
  for (const handle of RESIZE_HANDLES) {
    const p = handlePoint(rect, handle);
    if (Math.abs(point.x - p.x) <= radius && Math.abs(point.y - p.y) <= radius) {
      return handle;
    }
  }
  return null;
}

/** Is a point inside a rectangle? */
export function contains(rect: OverlayRect, point: Point): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.w &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.h
  );
}

// ── Applying a gesture ───────────────────────────────────────────────────────

/**
 * The rectangle a gesture produces, from the frame it STARTED on plus the total
 * pointer delta.
 *
 * From the start rect every time, never incrementally from the last frame. An
 * incremental version accumulates rounding at 60Hz and, worse, cannot be
 * re-run — and re-running is exactly what snapping needs (see snapDelta: the
 * snap is folded into the delta and this function is applied once more, so the
 * minimum-size clamp is enforced in one place rather than twice with different
 * answers).
 */
export function dragRect(
  start: OverlayRect,
  mode: DragMode,
  dx: number,
  dy: number,
): OverlayRect {
  if (mode === "move") {
    return { x: start.x + dx, y: start.y + dy, w: start.w, h: start.h };
  }
  let left = start.x;
  let top = start.y;
  let right = start.x + start.w;
  let bottom = start.y + start.h;
  // The clamp is applied to the MOVING edge, so a box shrunk to the floor stops
  // dead instead of turning inside out and reappearing on the other side of the
  // pointer — which is what an unclamped `w = start.w - dx` does the moment the
  // pointer crosses the far edge.
  if (mode.includes("n")) top = Math.min(top + dy, bottom - MIN_SIZE_PX);
  if (mode.includes("s")) bottom = Math.max(bottom + dy, top + MIN_SIZE_PX);
  if (mode.includes("w")) left = Math.min(left + dx, right - MIN_SIZE_PX);
  if (mode.includes("e")) right = Math.max(right + dx, left + MIN_SIZE_PX);
  return { x: left, y: top, w: right - left, h: bottom - top };
}

// ── Snapping ─────────────────────────────────────────────────────────────────

/**
 * How close an edge must come before it snaps, in overlay pixels.
 *
 * 6px is about 2mm on the preview at its usual width. Larger and the box refuses
 * to sit where it is put; smaller and the alignment a specialist is aiming for
 * is one they have to hit by hand, which is the whole thing snapping exists to
 * stop.
 */
export const SNAP_PX = 6;

/** A line the overlay draws while a gesture is snapped to something. */
export interface Guide {
  axis: "x" | "y";
  /** Overlay coordinate of the line itself. */
  at: number;
  /** Extent along the OTHER axis — from the moving box to what it aligns with. */
  from: number;
  to: number;
}

export interface SnapContext {
  /** The page box the element lives on. Its edges and centre are snap targets. */
  page: OverlayRect;
  /** The element's own slot — the engine's suggestion, still worth aligning to. */
  slot: OverlayRect;
  /** Every other painted element on the SAME page. */
  neighbours: readonly OverlayRect[];
  threshold?: number;
  /**
   * How far the MOVING box is turned (predecessor UAT 18C), or null/absent for
   * upright. Rotation is a later tranche; the rule for a turned box is kept
   * here — tested — so that the snap layer does not have to be re-taught it.
   *
   * A PROPERTY OF THE GESTURE, which is why it lives here beside `threshold`
   * rather than being a fourth argument to two functions: the call sites in
   * the overlay already build this object once per gesture, and an extra
   * parameter would be one a later caller could forget while the type still
   * compiled.
   *
   * ── WHAT IT CHANGES, AND WHAT WAS REJECTED ─────────────────────────────
   * A turned box's EDGES are not the screen's axes, so 「align its left edge with
   * that caption's left edge」 is not a sentence about anything: the box has no
   * left edge in the sense this file means. Its CENTRE, on the other hand, is
   * exactly as real as it ever was — it is the pivot, it does not move when the
   * angle changes, and centring a turned stamp on a plate or on the page is the
   * commonest thing anybody does with one.
   *
   * So while an object is turned, a MOVE offers its centre and nothing else, and
   * a RESIZE offers nothing at all. The TARGETS are untouched: a turned box's
   * centre meeting a neighbour's edge is a real, visible alignment, and
   * narrowing the targets to centres as well would remove it for no reason.
   *
   * SNAPPING THE BOUNDING BOX was the obvious alternative and it is refused. The
   * bounding box is a rectangle that exists nowhere on the page; snapping its
   * left edge to a margin puts one CORNER of the object on that margin and every
   * one of its edges somewhere else, and `guidesFor` would then draw a line the
   * object touches at a single point while claiming an alignment along its whole
   * length. That is the same lie the grouping fix in this file had to correct
   * once already, arriving by a different door.
   *
   * DISABLING SNAP ENTIRELY was the other, and it costs the one alignment that
   * still means something for no benefit — a turned object is exactly the one
   * you cannot place by eye.
   *
   * SNAPPING THE ANGLE is a real feature and it is not this one: it belongs to
   * the rotate gesture, where the modifier key constrains to a 15° ladder.
   * Folding it in here would put two unrelated quantities behind one threshold.
   */
  rotationDeg?: number | null;
}

/** One candidate line, with the box that justifies drawing it. */
interface Target {
  value: number;
  src: OverlayRect;
}

function xTargets(ctx: SnapContext): Target[] {
  const out: Target[] = [];
  // NEIGHBOURS FIRST, and the strict `<` in the search below makes that an
  // ordering preference: when an element edge and a page edge are equidistant,
  // aligning to the neighbour is the alignment a person can see.
  for (const r of ctx.neighbours) push(out, r, "x");
  push(out, ctx.slot, "x");
  push(out, ctx.page, "x");
  return out;
}

function yTargets(ctx: SnapContext): Target[] {
  const out: Target[] = [];
  for (const r of ctx.neighbours) push(out, r, "y");
  push(out, ctx.slot, "y");
  push(out, ctx.page, "y");
  return out;
}

/** Left/centre/right (or top/centre/bottom) of one box, as targets. */
function push(out: Target[], src: OverlayRect, axis: "x" | "y"): void {
  if (axis === "x") {
    out.push({ value: src.x, src });
    out.push({ value: src.x + src.w / 2, src });
    out.push({ value: src.x + src.w, src });
  } else {
    out.push({ value: src.y, src });
    out.push({ value: src.y + src.h / 2, src });
    out.push({ value: src.y + src.h, src });
  }
}

/**
 * The values on the moving box that this gesture can align with something.
 *
 * A MOVE offers all three (left, centre, right) because the whole box travels; a
 * resize offers only the edges it is actually dragging. Offering all three
 * during an `e` resize would snap the LEFT edge to a neighbour — by moving the
 * right one, since that is all the gesture can do — which is a box changing size
 * to satisfy an alignment nobody asked for.
 */
function movingValues(
  rect: OverlayRect,
  mode: DragMode,
  axis: "x" | "y",
  // How far the box is TURNED. See SnapContext.rotationDeg for the whole
  // argument and for the two alternatives it refuses.
  turned = false,
): number[] {
  const lo = axis === "x" ? rect.x : rect.y;
  const size = axis === "x" ? rect.w : rect.h;
  // A TURNED BOX OFFERS ITS CENTRE AND NOTHING ELSE, and only while it is being
  // moved. `rect` here is still the upright frame — the rectangle that is
  // stored, and whose centre IS the turned object's centre, because the pivot is
  // the centre. So this one value stays exactly as true after the turn as
  // before it, which is what makes it the only one worth offering.
  if (turned) return mode === "move" ? [lo + size / 2] : [];
  if (mode === "move") return [lo, lo + size / 2, lo + size];
  const near = axis === "x" ? "w" : "n";
  const far = axis === "x" ? "e" : "s";
  const out: number[] = [];
  if (mode.includes(near)) out.push(lo);
  if (mode.includes(far)) out.push(lo + size);
  return out;
}

/** Is this gesture's box turned? One reading of the context, so snapDelta and
 *  guidesFor cannot disagree about it — which would draw a guide for an
 *  alignment the snap did not make. */
function isTurned(ctx: SnapContext): boolean {
  return (
    ctx.rotationDeg !== null &&
    ctx.rotationDeg !== undefined &&
    Number.isFinite(ctx.rotationDeg) &&
    ctx.rotationDeg !== 0
  );
}

/**
 * The adjustment that puts this gesture on the nearest alignment, per axis.
 *
 * Returned as a DELTA to fold back into the pointer delta rather than as a
 * corrected rectangle, so dragRect runs exactly once on the combined number and
 * the minimum-size clamp cannot be applied twice with two different answers.
 */
export function snapDelta(
  rect: OverlayRect,
  mode: DragMode,
  ctx: SnapContext,
): Point {
  const threshold = ctx.threshold ?? SNAP_PX;
  const turned = isTurned(ctx);
  return {
    x: bestDelta(movingValues(rect, mode, "x", turned), xTargets(ctx), threshold),
    y: bestDelta(movingValues(rect, mode, "y", turned), yTargets(ctx), threshold),
  };
}

function bestDelta(
  values: readonly number[],
  targets: readonly Target[],
  threshold: number,
): number {
  let best = 0;
  let bestDist = Infinity;
  for (const t of targets) {
    for (const v of values) {
      const d = Math.abs(t.value - v);
      // Strictly closer, so the first target in list order wins a tie — and the
      // list is ordered neighbours, slot, page.
      if (d <= threshold && d < bestDist) {
        bestDist = d;
        best = t.value - v;
      }
    }
  }
  return best;
}

/**
 * The lines to draw for a rectangle that has ALREADY been snapped.
 *
 * Computed from the final geometry rather than remembered from snapDelta, which
 * makes a guide unable to lie: it is drawn if and only if an edge genuinely
 * coincides with something, so a snap the minimum-size clamp overrode shows no
 * line instead of a line the box is not on.
 *
 * ONE LINE PER DISTINCT ALIGNMENT, grouped by the coordinate it sits on. Every
 * target on that same coordinate contributes its EXTENT, so a caption aligned
 * with three lots below it gets one line reaching all three — which says "these
 * four agree" in a way three separate stubs do not. Quiet chrome is a
 * requirement here (this is an auction catalogue, not a design tool demo), and
 * one long line is quieter than three short ones.
 *
 * The grouping is not tidiness, it is a defect this shipped once and a
 * photograph caught: the first version drew a single line per axis at the FIRST
 * matching value while unioning the extents of ALL matches. Dragging a plate
 * whose left edge met the caption (x=727) and whose centre met the page centre
 * (x=1140) drew one line at 727 stretched over the whole page height — a line
 * standing on one alignment while claiming the reach of another. Two real
 * alignments are two lines.
 */
export function guidesFor(
  rect: OverlayRect,
  mode: DragMode,
  ctx: SnapContext,
): Guide[] {
  const guides: Guide[] = [];
  const axes: Array<"x" | "y"> = ["x", "y"];
  const turned = isTurned(ctx);
  // HOW FAR THE LINE REACHES ALONG THE MOVING BOX. The guide always touches the
  // thing being dragged, so it is visibly ABOUT this gesture — and for a turned
  // box the thing being dragged is the quad, not the frame. Its bounds are the
  // right extent HERE, where the only question is 「how far up and down does
  // this box go」, and are emphatically the wrong thing to SNAP to (see
  // SnapContext.rotationDeg). The two uses are separated on purpose: a guide's
  // reach is chrome and its POSITION is a claim.
  const reach = turned ? rotatedBounds(rect, ctx.rotationDeg as number) : rect;
  for (const axis of axes) {
    const values = movingValues(rect, mode, axis, turned);
    const targets = axis === "x" ? xTargets(ctx) : yTargets(ctx);
    // Sub-pixel: the snap lands the edge exactly on the target in exact
    // arithmetic, and 0.01px absorbs the float noise of the two additions that
    // got it there. A tolerance the size of the snap threshold would draw a line
    // for every near miss, which is a guide that means nothing.
    const byValue = new Map<number, Guide>();
    for (const t of targets) {
      if (!values.some((v) => Math.abs(t.value - v) < 0.01)) continue;
      // Rounded key, same tolerance: two targets a thousandth of a pixel apart
      // are one alignment, and drawing two lines there would be a hairline that
      // looks like a rendering fault.
      const key = Math.round(t.value * 100) / 100;
      const lo = axis === "x" ? t.src.y : t.src.x;
      const hi = axis === "x" ? t.src.y + t.src.h : t.src.x + t.src.w;
      const existing = byValue.get(key);
      if (existing) {
        existing.from = Math.min(existing.from, lo);
        existing.to = Math.max(existing.to, hi);
        continue;
      }
      byValue.set(key, {
        axis,
        at: t.value,
        // The line always reaches the box being moved, so it is visibly ABOUT
        // this gesture rather than a rule floating elsewhere on the page.
        from: Math.min(axis === "x" ? reach.y : reach.x, lo),
        to: Math.max(axis === "x" ? reach.y + reach.h : reach.x + reach.w, hi),
      });
    }
    guides.push(...byValue.values());
  }
  return guides;
}

// ── The boundary: overlay pixels ⇄ PAGE fractions ────────────────────────────

/** A frame in PAGE coordinates — fractions of the page box, top-left origin. */
export type PageFrame = OverrideFrame;

/**
 * An overlay rectangle as a fraction of its PAGE box.
 *
 * THE CONVERSION THE WHOLE FEATURE RESTS ON. Page coordinates and not slot
 * coordinates because a placed element can leave its slot, at which point a
 * slot-relative number describes a box outside the thing it is relative to;
 * the renderer positions the stored frame against the page directly
 * (src/lib/render/html.ts), so what is stored is what is painted.
 *
 * Both rectangles are in the SAME space — the overlay layer's — so this is a
 * translate and a scale and nothing else. In particular there is no scroll term:
 * the page rect is re-read from the live DOM on the same pass as the element
 * rect, so both already carry the scroll, and adding it here would double it.
 * That is the same negative case selection-geometry.ts pins for toOverlayRect,
 * and it is worth restating because this is the function whose error would be
 * PERSISTED rather than merely painted.
 *
 * A degenerate page box (an iframe not yet laid out, a display:none ancestor)
 * yields zeros rather than Infinity — the caller checks and refuses to commit,
 * because saving Infinity would make the value unreadable on the next parse.
 */
export function toPageFrame(rect: OverlayRect, page: OverlayRect): PageFrame {
  if (page.w <= 0 || page.h <= 0) return { x: 0, y: 0, w: 0, h: 0 };
  return {
    x: (rect.x - page.x) / page.w,
    y: (rect.y - page.y) / page.h,
    w: rect.w / page.w,
    h: rect.h / page.h,
  };
}

/** The inverse, for painting a stored frame back onto the overlay. */
export function fromPageFrame(frame: PageFrame, page: OverlayRect): OverlayRect {
  return {
    x: page.x + frame.x * page.w,
    y: page.y + frame.y * page.h,
    w: frame.w * page.w,
    h: frame.h * page.h,
  };
}

/**
 * Is this frame worth saving?
 *
 * THE SERVER'S OWN PREDICATE, not a mirror of it: the predecessor kept a copy
 * here and a copy in its payload schema and wrote "mirrors the server's own
 * refusal" over the first. One function in src/lib/engine/frame.ts is what
 * makes that sentence a fact rather than a promise.
 */
export function committable(frame: PageFrame): boolean {
  return intersectsPage(frame);
}

// ── Keyboard nudge ───────────────────────────────────────────────────────────

/** One arrow press. Coarse is what Shift buys. */
export const NUDGE_PX = 1;
export const NUDGE_COARSE_PX = 10;

/**
 * The delta an arrow key means, or null for any other key.
 *
 * IN SCREEN PIXELS, not millimetres, and that is the honest unit: the specialist
 * is looking at a screen and pressing a key to move what they see by a little or
 * by a lot. It converts to page fractions on commit exactly as a drag does, so
 * the same nudge at a wider preview is a smaller physical move — which is also
 * what "a pixel" means everywhere else on the machine.
 */
export function nudgeDelta(key: string, coarse: boolean): Point | null {
  const step = coarse ? NUDGE_COARSE_PX : NUDGE_PX;
  switch (key) {
    case "ArrowLeft":
      return { x: -step, y: 0 };
    case "ArrowRight":
      return { x: step, y: 0 };
    case "ArrowUp":
      return { x: 0, y: -step };
    case "ArrowDown":
      return { x: 0, y: step };
    default:
      return null;
  }
}

// ── The picture inside the frame ─────────────────────────────────────────────

/** The subject box a renderer publishes on a plate, as fractions of the file. */
export interface ContentBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The whole picture — what an unmeasured image gets. */
export const FULL_CONTENT: ContentBox = { x: 0, y: 0, w: 1, h: 1 };

/**
 * Parse `data-content="x,y,w,h"`. Anything malformed reads as the full picture,
 * because a wrong subject box is worse than none: it would draw an outline
 * around a part of the plate that is not the artwork.
 *
 * This renderer publishes no subject box yet — a plate is object-fit inside
 * its frame — so every plate reads as the full picture today. The parser is
 * here for the day `assets.geometry` carries a measured subject and the
 * renderer says so.
 */
export function parseContent(attr: string | null | undefined): ContentBox {
  if (!attr) return FULL_CONTENT;
  const parts = attr.split(",").map(Number);
  if (parts.length !== 4 || !parts.every(Number.isFinite)) return FULL_CONTENT;
  const [x, y, w, h] = parts as [number, number, number, number];
  if (w <= 0 || h <= 0) return FULL_CONTENT;
  return { x, y, w, h };
}

/**
 * Where the PICTURE actually is, given the `<img>` box and its subject fractions.
 *
 * A renderer that places by subject sizes and offsets the `<img>` so the SUBJECT
 * meets the frame's edges, which means the `<img>` element is deliberately
 * larger than the frame and hangs outside it. So neither box on its own is the
 * picture: the element box is the file, the frame is the reserved area, and the
 * artwork is this. The predecessor's live audit did the identical arithmetic for
 * the identical reason — measuring the element box reported a 57% spread on a
 * page that had just been corrected.
 */
export function subjectRect(img: OverlayRect, content: ContentBox): OverlayRect {
  return {
    x: img.x + content.x * img.w,
    y: img.y + content.y * img.h,
    w: content.w * img.w,
    h: content.h * img.h,
  };
}

/**
 * Do these two boxes differ enough to be worth telling the human about?
 *
 * The frame-versus-picture problem in one predicate. A plate whose picture is
 * narrower than its frame — an object-fit portrait in a landscape box — carries
 * obvious empty slack beside the artwork, so the selection ring is visibly
 * bigger than the thing it rings and reads as a bug (ROADMAP M1, carried
 * defects: "object selection shows a larger frame than the image it contains").
 * But the frame is the right box to STORE, because the frame is what the
 * renderer positions. So the ring stays the frame and the picture gets a second,
 * quieter outline, drawn only when the gap is large enough to be the thing that
 * confused them.
 *
 * 3px is about a millimetre on the preview: below that the second outline would
 * sit on top of the first and read as a rendering artefact rather than as
 * information.
 */
export function boxesDiffer(a: OverlayRect, b: OverlayRect, px = 3): boolean {
  return (
    Math.abs(a.x - b.x) > px ||
    Math.abs(a.y - b.y) > px ||
    Math.abs(a.x + a.w - (b.x + b.w)) > px ||
    Math.abs(a.y + a.h - (b.y + b.h)) > px
  );
}
