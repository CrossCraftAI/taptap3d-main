// What the overlay draws, and what a gesture on it is worth committing.
//
// THE PARENT'S MODEL OF THE CHILD'S PAGE. selection-geometry.ts moves one
// rectangle out of the preview's coordinates and drag-geometry.ts turns one
// gesture into one rectangle; neither knows how many boxes there are, which one
// is selected, or whether the result is worth a row in the database. That is
// this file, and it is the last layer before a component — so it is the last
// layer that can be tested at all.
//
// SEPARATE FROM THE COMPONENT for the reason its two neighbours already give
// and this one inherits whole: vitest runs in a node environment with no jsdom
// (vitest.config.ts says why), so preview-canvas.tsx and selection-overlay.tsx
// cannot be rendered in a test. Everything decidable from plain rectangles is
// decided here; the components keep the listeners, the refs and the paint.
//
// ── IT READS ATTRIBUTES AND NEVER RECONSTRUCTS THEM ─────────────────────────
//
// The renderer publishes `data-lot`, `data-field`, `data-frame-source` and
// `data-page-frame` precisely so this layer can ask rather than infer
// (src/lib/render/html.ts, "what an overlay needs to know, published rather
// than inferred"). The names are declared once, below, and the test asserts
// them against a real rendered document — so the contract is checked rather
// than promised, which is the failure the predecessor paid for four times: a
// check that reconstructs what it should have been told cannot fail when the
// thing it reconstructs changes.

import { frameFromValue } from "@/lib/engine/frame";

import { boxesDiffer, committable, dragRect, toPageFrame, type PageFrame } from "./drag-geometry";
import {
  sameSelection,
  selectionKey,
  type OverlayRect,
  type PreviewSelection,
  type SelectionRing,
} from "./selection-geometry";

// ── The attribute contract ───────────────────────────────────────────────────

/**
 * Every attribute this layer reads off the preview, by name.
 *
 * ONE DECLARATION, read by the component and by the test that holds it against
 * `renderCatalogue`'s output. A string typed twice is a contract that can drift
 * silently in the direction that matters least — the overlay simply stops
 * finding anything, on a page that still looks right.
 */
export const ATTR = {
  /** The lot this element belongs to. On the entry as well as on each part. */
  lot: "data-lot",
  /** The field key — the second half of the override key. Absent on the entry. */
  field: "data-field",
  /** Present, and equal to `override`, when a PERSON placed this part. */
  placedBy: "data-frame-source",
  /** Where they placed it: "x,y,w,h" in page fractions. */
  frame: "data-page-frame",
  /** A plate's measured subject box, when one day the renderer measures one. */
  content: "data-content",
} as const;

/** The value `data-frame-source` carries for a hand-placed part. */
export const PLACED_BY_HAND = "override";

/** Everything with an identity an override could be written against. */
export const PART_SELECTOR = `[${ATTR.field}]`;

/** The parts a person has already placed — few, so they can be measured often. */
export const PLACED_SELECTOR = `[${ATTR.placedBy}="${PLACED_BY_HAND}"]`;

/** The sheet. It is the denominator of every frame this layer commits. */
export const PAGE_SELECTOR = ".page";

/**
 * The frame a part is already placed at, read back off `data-page-frame`, or
 * null when the engine put it there and nobody has moved it.
 *
 * WHY READ IT AT ALL, when the box is right there on screen: because undo needs
 * the value that was STORED, not the rectangle that was painted. The two differ
 * by the rounding the renderer does on its way to a CSS percentage and by
 * whatever the browser's own layout did with it, and an undo that wrote back a
 * re-measured box would move the part by a hair every time — a correction
 * nobody made, applied on the gesture whose entire promise is that it changes
 * nothing.
 *
 * VALIDATED BY THE ENGINE'S OWN READER rather than by four `Number.isFinite`
 * calls here. `frameFromValue` is the function that decides what a stored frame
 * IS — all four or nothing, no zero-sized box — and a second opinion in the
 * client would be a second thing to keep in step.
 *
 * Exactly four parts. A longer string is not a frame with extra on the end; it
 * is an attribute this layer does not understand, and taking its first four
 * numbers would be a guess at somebody else's data.
 */
export function parsePageFrame(attr: string | null | undefined): PageFrame | null {
  if (!attr) return null;
  const parts = attr.split(",");
  if (parts.length !== 4) return null;
  const [x, y, w, h] = parts.map(Number);
  return frameFromValue({ x, y, w, h });
}

// ── What the component measures ──────────────────────────────────────────────

/**
 * The four numbers that say whether a box is showing all of its ink.
 *
 * Read off the child element rather than derived, for the reason the whole
 * layer exists: the painted box already carries CJK line wrapping and the fluid
 * type scale, and the only thing that knows whether the text fits is the box.
 */
export interface BoxFit {
  scrollW: number;
  scrollH: number;
  clientW: number;
  clientH: number;
}

/** One painted part of the preview, measured into the overlay's coordinates. */
export interface MeasuredPart {
  /** (lot, field). Never an element id — `identityFrom` refuses a half-identity. */
  sel: PreviewSelection;
  /** The painted box. */
  rect: OverlayRect;
  /** The `.page` it sits on. A degenerate one is what stops a commit. */
  page: OverlayRect;
  /** A person placed it, i.e. the renderer published `data-frame-source`. */
  placed: boolean;
  /**
   * Where the PICTURE is inside a plate's frame, when there is one to measure.
   *
   * The frame is the reserved area and an object-fit picture sits inside it, so
   * for a portrait photograph in a landscape box the two genuinely differ — see
   * `boxesDiffer`, and ROADMAP M1's carried defect "object selection shows a
   * larger frame than the image it contains".
   */
  picture?: OverlayRect | null;
  /** Absent for a part whose overflow was not measured; see clipOverflow. */
  fit?: BoxFit;
}

// ── Rings ────────────────────────────────────────────────────────────────────

/**
 * What the overlay has to paint, this frame.
 *
 * `live` is the rectangle a running drag has reached, in overlay pixels. It
 * REPLACES the selection's measured box rather than adding to it: the ink has
 * not moved — nothing writes into the preview (ARCHITECTURE.md) — so the ring
 * is the only thing on screen that follows the pointer, and two rings would say
 * the part is in both places at once.
 */
export interface OverlayView {
  parts: readonly MeasuredPart[];
  selected: PreviewSelection | null;
  hovered: PreviewSelection | null;
  live: OverlayRect | null;
  /**
   * Subject-box mode: the specialist is correcting where the ARTWORK is inside
   * the plate rather than where the plate is on the page. A later tranche —
   * nothing turns this on yet — and it is here because the palette rule it
   * settles is stated on `SelectionRing.kind` and would otherwise have to be
   * rediscovered by whoever wires the mode.
   */
  subjectMode?: boolean;
}

/** The part of `parts` this identity refers to, or null. */
function partFor(
  parts: readonly MeasuredPart[],
  sel: PreviewSelection | null,
): MeasuredPart | null {
  if (!sel) return null;
  return parts.find((p) => sameSelection(p.sel, sel)) ?? null;
}

/**
 * The rings, in paint order — later is on top.
 *
 * ── WHY THE HOVER IS FIRST AND THE PICTURE LAST ─────────────────────────────
 * A hover is a whisper and the selection is a statement, so where they overlap
 * the statement wins. The picture outline is drawn last because it is INSIDE
 * the frame it qualifies: painted under the frame's own ring it would be the
 * one line hidden by the thing it is explaining, on exactly the plate where the
 * explanation is needed.
 *
 * ── THE ACCENT IS THE SEAL, NOT BLUE ────────────────────────────────────────
 * `SelectionRing.kind` carries the predecessor's rule — "blue is the thing you
 * are manipulating" — and this palette has no blue in it. src/app/globals.css
 * says why: a specialist proofs a photograph's colour against the ground it
 * sits on, so the interface is true grey with exactly one chromatic value. The
 * RULE survives the palette change intact, because it was never about the hue:
 * one accent marks what the pointer acts on, and everything else is grey. The
 * component picks the colours; this decides which ring is the accent one.
 *
 * NO HOVER WHILE A DRAG RUNS. The pointer is over a capture layer rather than
 * over the page, so whatever the hover last said is stale — and a second ring
 * appearing under a box being dragged reads as a drop target, which this slice
 * has no such thing as.
 */
export function ringsFor(view: OverlayView): SelectionRing[] {
  const rings: SelectionRing[] = [];
  const dragging = view.live !== null;
  const selected = partFor(view.parts, view.selected);

  const hovered = partFor(view.parts, view.hovered);
  if (hovered && !dragging && !sameSelection(hovered.sel, view.selected)) {
    rings.push({
      key: `${selectionKey(hovered.sel)}|hover`,
      kind: "hover",
      rect: hovered.rect,
    });
  }

  if (!selected) return rings;

  // The picture is only worth a second outline when it is visibly not the
  // frame, and `boxesDiffer` is where "visibly" is decided. While a drag runs
  // there is no honest place to put it: the frame has moved and the picture
  // has not, so it is left off rather than drawn where the plate no longer is.
  const picture =
    !dragging && selected.picture && boxesDiffer(selected.rect, selected.picture)
      ? selected.picture
      : null;
  const subject = view.subjectMode === true && picture !== null;

  rings.push({
    key: `${selectionKey(selected.sel)}|frame`,
    kind: subject ? "muted" : "selected",
    rect: view.live ?? selected.rect,
  });
  if (picture) {
    rings.push({
      key: `${selectionKey(selected.sel)}|picture`,
      kind: subject ? "subject" : "muted",
      rect: picture,
    });
  }
  return rings;
}

// ── The clipping mark ────────────────────────────────────────────────────────

/**
 * Sub-pixel slack before a cut is called a cut.
 *
 * The same one pixel, for the same reason, as selection-geometry.ts's
 * GROWTH_EPSILON_PX: these boxes are laid out from page fractions against a
 * measured page, so `scrollHeight` and `clientHeight` land a fraction apart on
 * a box whose text fits exactly. Marking that would put a warning on every
 * placed part, and a warning on all of them is the same as none.
 */
const CLIP_EPSILON_PX = 1;

/** How far a box's ink overruns it, in overlay pixels. Zero means it all shows. */
export function clipOverflow(fit: BoxFit): { x: number; y: number } {
  const x = fit.scrollW - fit.clientW;
  const y = fit.scrollH - fit.clientH;
  return {
    x: x > CLIP_EPSILON_PX ? x : 0,
    y: y > CLIP_EPSILON_PX ? y : 0,
  };
}

/**
 * A placed part whose text does not fit the box somebody drew for it.
 *
 * `rect` is the whole box and not the strip of missing ink, which is the
 * opposite of `GrowthMark`'s choice and is the same reasoning read the other
 * way. A grown caption's overflow is ON the page — it is the millimetres
 * sitting on the lot below — so the strip is where the problem is. A clipped
 * box's overflow is NOWHERE: it was never painted, and a strip drawn below the
 * box would claim ink is somewhere it is not. The box is what the specialist
 * has to make bigger, so the box is what is marked.
 */
export interface ClipMark {
  key: string;
  rect: OverlayRect;
  /** How much ink is missing, in overlay pixels, on the axis that is cut. */
  overflowPx: number;
  axis: "x" | "y" | "both";
}

/**
 * Every hand-placed part that is cutting its own text.
 *
 * ── THE DEFECT THIS EXISTS FOR, AND IT IS WORSE THAN A FADE ─────────────────
 * `.placed` carries `overflow: hidden` (src/lib/render/html.ts), because a box
 * whose text ran out of it would run across the lot beneath. The caption boxes
 * a part is lifted OUT of carry a gradient at their foot — "there is more" —
 * and the print stylesheet turns that gradient off, because a printed page has
 * no "continues" and the same fade reads as a press running out of ink.
 *
 * A placed part gets neither. The fade rule is keyed to `.caption`, and a
 * placed part is emitted as a child of `.page`, outside `.live` and outside any
 * caption — so a placed box that cannot hold its text cuts it silently on the
 * screen AND on the paper.
 *
 * ── AND A MOVE IS ENOUGH TO GET THERE, WHICH IS NOT OBVIOUS ─────────────────
 * A move does not change w or h, so the box a drag leaves behind holds exactly
 * what it held a moment earlier. What the drag changes is that the size stops
 * being decided by the layout and becomes a FRACTION OF THE PAGE — frozen —
 * while the type scale does not freeze with it. The renderer's body size is
 * `clamp(7px, Nvh, cap)`, i.e. a share of the FRAME's height, and at fit:width
 * the page's height follows the frame's WIDTH instead. So changing the window's
 * proportions, or switching fit, or shrinking it until the clamp's 7px floor
 * takes over, moves the type relative to a box that no longer moves with it.
 *
 * Nobody touches the part; it starts cutting. That is precisely the state a
 * person cannot be expected to find by looking, and the reason the mark ships
 * with the gesture that creates the frozen box rather than with the resize
 * handles that will later make it direct.
 *
 * PLACED PARTS ONLY, deliberately. An in-flow caption can clip too, and it is
 * the engine's caption budget that decides whether it does — a deterministic
 * property of the document, which belongs to the defect gate (principle 4) and
 * not to an overlay. Marking all of them would put amber on most rows of a
 * 43-page flow, which is the "warning on everything" failure GROWTH_EPSILON_PX
 * already refuses.
 */
export function clipMarks(parts: readonly MeasuredPart[]): ClipMark[] {
  const marks: ClipMark[] = [];
  for (const part of parts) {
    if (!part.placed || !part.fit) continue;
    const over = clipOverflow(part.fit);
    if (over.x === 0 && over.y === 0) continue;
    marks.push({
      key: `${selectionKey(part.sel)}|clip`,
      rect: part.rect,
      overflowPx: Math.max(over.x, over.y),
      axis: over.x > 0 && over.y > 0 ? "both" : over.x > 0 ? "x" : "y",
    });
  }
  return marks;
}

/** Would painting these marks change anything? Same reasoning as `sameRings`. */
export function sameClips(a: readonly ClipMark[], b: readonly ClipMark[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((mark, i) => {
    const other = b[i]!;
    return (
      mark.key === other.key &&
      mark.axis === other.axis &&
      mark.overflowPx === other.overflowPx &&
      mark.rect.x === other.rect.x &&
      mark.rect.y === other.rect.y &&
      mark.rect.w === other.rect.w &&
      mark.rect.h === other.rect.h
    );
  });
}

// ── The gesture, and the gate in front of the database ───────────────────────

/**
 * How far a pointer must travel before a press becomes a drag.
 *
 * ── WHAT IT COSTS TO GET WRONG IN EITHER DIRECTION ──────────────────────────
 * At zero, every click on a plate writes a frame: a row appears in `overrides`
 * for a part nobody moved, the engine stops deriving that part's position, and
 * the specialist's only clue is that the part no longer follows a density
 * change. At ten, the small deliberate nudge — the gesture a specialist makes
 * most, because the engine already put the part nearly right — is swallowed,
 * and they press harder rather than believing the tool.
 *
 * Three is under drag-geometry.ts's SNAP_PX, which is the only other screen
 * distance this layer has: a gesture can therefore begin before it can snap to
 * anything, which is the order those two have to be in.
 */
export const DRAG_THRESHOLD_PX = 3;

/** Has this press travelled far enough to be a drag rather than a click? */
export function isDrag(dx: number, dy: number, threshold = DRAG_THRESHOLD_PX): boolean {
  return Math.abs(dx) >= threshold || Math.abs(dy) >= threshold;
}

/**
 * The frame this gesture would store, or null when it must not be stored.
 *
 * THE WHOLE BOUNDARY IN ONE FUNCTION, and the one place a silent error would be
 * indistinguishable from a correct edit (drag-geometry.ts's header). It runs
 * the gesture with `dragRect`, converts with `toPageFrame`, and asks
 * `committable` — which is the SERVER'S OWN predicate rather than a copy of it
 * (src/lib/engine/frame.ts) — so the browser never posts what the database
 * would refuse, and the two cannot drift apart.
 *
 * Null covers both refusals at once and deliberately does not distinguish them:
 * a page box of zero (a frame that has not laid out yet) converts to a frame of
 * zero size, which `committable` refuses for the same reason it refuses a part
 * dragged off the paper. Either way there is nothing to save and the caller
 * puts the part back.
 */
export function placementFrame(
  start: OverlayRect,
  page: OverlayRect,
  dx: number,
  dy: number,
): PageFrame | null {
  const frame = toPageFrame(dragRect(start, "move", dx, dy), page);
  return committable(frame) ? frame : null;
}
