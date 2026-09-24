// The condition viewer's pure half — the reference view as a coordinate space.
//
// ── WHY THIS IS A SEPARATE FILE ─────────────────────────────────────────────
//
// The same reason src/lib/editor/selection-geometry.ts is one, in that file's
// own words: vitest here runs in a node environment with no jsdom, so
// condition-viewer.tsx cannot be rendered in a test. Everything that can be
// decided without a DOM lives here and is tested; the component keeps the
// listeners, the refs and the paint.
//
// It buys a second thing this feature needed. The RING the viewer draws and the
// TOLERANCE the lifetime view groups by are two statements about one circle,
// and they were about to live in a client component and in a module that opens
// a database — two files that cannot import each other. They live here, where
// both can, so the relationship between them is checked by a test rather than
// by two comments pointing at each other.
//
// ── IT BUILDS ON THE EDITOR'S GEOMETRY RATHER THAN REPEATING IT ─────────────
//
// `pinPoint`, `pinAnchor` and `samePins` already answer "where does a mark hang
// off a box", "which part of a frame is actually picture" and "is this repaint
// worth doing". A condition mark asks all three. A second implementation of
// "just outside the top-right" would drift, and the one that drifts is the one
// nobody is looking at.

import {
  pinAnchor,
  pinPoint,
  samePins,
  type CommentPin,
  type OverlayRect,
  type Point,
} from "@/lib/editor/selection-geometry";

/**
 * The proportion of every reference view.
 *
 * TALLER THAN WIDE, because the objects are: a vase, a scroll, a standing
 * figure. One proportion for all three views, so switching view does not
 * resize the screen under the reader's hand — and a fraction is a fraction
 * whatever the box, so the square base view loses nothing by it.
 */
export const VIEW_ASPECT = 240 / 380;

/**
 * The ring's radius, as a fraction of the view's WIDTH.
 *
 * Small on purpose: the ring points at a fault, it does not cover one. The
 * mockup draws the numeral inside the ring; on a condition mark that is a
 * numeral sitting on the chip, and the chip is what the report exists to show.
 */
export const MARK_RADIUS = 0.035;

/**
 * How close two marks must be, in fractions of the view, to be the same fault
 * seen twice.
 *
 * MEASURED AGAINST THE RING ABOVE rather than chosen. Two marks closer together
 * than one ring RADIUS overlap on screen, and a registrar could not have placed
 * them as two distinct faults — so the radius is the ceiling and this sits
 * under it. `test/condition.test.ts` holds that relationship, which is the
 * whole reason the two constants are in one file.
 *
 * Rejected: a `marks.carried_from` column — the previous examination's mark
 * this one continues — which is the storable, human-confirmed version of the
 * same judgement and is strictly better. It is not here because nothing yet
 * asks a registrar the question, and a nullable column nobody writes reads as
 * "no mark was ever carried" rather than as "nobody has said". The day the
 * lifetime view gets a "this is the same chip" control, that column arrives
 * with it and this becomes the PROPOSAL the control confirms (principle 9).
 */
export const MARK_SAME_WITHIN = 0.03;

/** What the viewer needs of a mark. The number is derived upstream, never stored. */
export interface ViewerMark {
  id: string;
  /** 1-based within this view. */
  number: number;
  x: number;
  y: number;
  /**
   * How many examinations recorded this fault — 1 in the examination view, more
   * in the lifetime one. It becomes `CommentPin.count`, which is what turns a
   * badge from "mark 3" into "mark 3, seen four times".
   */
  sightings: number;
}

/**
 * Where an `object-fit: contain` picture actually lands inside its box.
 *
 * The browser knows and will not say, so it is computed from the two numbers it
 * does give: the box it was told to fill, and the image's own dimensions. This
 * is not "reading rendered output" — it is the same arithmetic `object-fit`
 * does, from inputs the DOM hands over — and it is the only way to tell which
 * part of the box is picture and which is the grey beside it.
 *
 * Null for an image with no dimensions yet: the honest answer before `load`,
 * and `pinAnchor` turns it into "the whole frame", which is what a view with no
 * photograph should be.
 */
export function containedPicture(
  frame: OverlayRect,
  natural: { w: number; h: number } | null,
): OverlayRect | null {
  if (!natural) return null;
  if (natural.w <= 0 || natural.h <= 0 || frame.w <= 0 || frame.h <= 0) return null;
  const scale = Math.min(frame.w / natural.w, frame.h / natural.h);
  const w = natural.w * scale;
  const h = natural.h * scale;
  return { x: frame.x + (frame.w - w) / 2, y: frame.y + (frame.h - h) / 2, w, h };
}

/** The ring's own box, in overlay pixels — what `pinPoint` hangs the number off. */
export function markRect(mark: ViewerMark, frame: OverlayRect): OverlayRect {
  const r = MARK_RADIUS * frame.w;
  return {
    x: frame.x + mark.x * frame.w - r,
    y: frame.y + mark.y * frame.h - r,
    w: r * 2,
    h: r * 2,
  };
}

/**
 * Where a tap counts: the frame, intersected with the painted picture.
 *
 * `pinAnchor`'s own defect, arrived at from the other side. There it was a
 * plate whose frame is the reserved area and whose picture sits low inside it,
 * so a mark hung on the frame landed in empty paper. Here it is a portrait
 * photograph in a portrait box, which still leaves grey down both sides — and a
 * tap there is a tap on nothing: the registrar missed the object, and a fault
 * recorded in the grey sits beside the object for every reader afterwards.
 *
 * With no picture the anchor is the whole frame, which is the honest answer —
 * there is nothing to be outside of, and a view with no photograph is still a
 * space a registrar can mark up.
 */
export function tappableRegion(
  frame: OverlayRect,
  natural: { w: number; h: number } | null,
): OverlayRect {
  return pinAnchor(frame, containedPicture(frame, natural));
}

/** Is this point inside the region a mark may be placed in? */
export function within(region: OverlayRect, at: Point): boolean {
  return (
    at.x >= region.x &&
    at.y >= region.y &&
    at.x <= region.x + region.w &&
    at.y <= region.y + region.h
  );
}

/**
 * A tap, as fractions of the VIEW — or null when it landed off the object.
 *
 * FRACTIONS OF THE FRAME AND NOT OF THE PICTURE. The view is the stable
 * coordinate space (src/db/schema.ts on `marks`); the picture only decides
 * whether the tap counted. Storing fractions of the picture would move every
 * mark the day a photograph is replaced with one of a different shape, which
 * is the whole failure this discipline exists to prevent.
 */
export function tapToFraction(
  frame: OverlayRect,
  natural: { w: number; h: number } | null,
  at: Point,
): Point | null {
  if (frame.w <= 0 || frame.h <= 0) return null;
  if (!within(tappableRegion(frame, natural), at)) return null;
  return { x: (at.x - frame.x) / frame.w, y: (at.y - frame.y) / frame.h };
}

/**
 * The numbered badges, in the order the marks were given.
 *
 * ONE PIN PER MARK AND IN THE SAME ORDER, because the caller pairs them by
 * index to draw the number — `CommentPin` carries a key and a count, not an
 * ordinal, and inventing a parallel identity here would be a second answer to
 * "which mark is this".
 */
export function pinsFor(
  marks: readonly ViewerMark[],
  frame: OverlayRect,
): CommentPin[] {
  return marks.map((mark) => ({
    key: mark.id,
    at: pinPoint(markRect(mark, frame)),
    count: mark.sightings,
  }));
}

/**
 * Would painting these badges change anything?
 *
 * Re-exported rather than re-implemented: the viewer re-measures on every
 * resize, and without this it would `setState` a fresh array per frame while
 * somebody drags a window edge. Exact equality, for the reason `sameRings`
 * gives — a badge that lags the mark it numbers is worse than a re-render.
 */
export { samePins };
export type { CommentPin, OverlayRect, Point };
