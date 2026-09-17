// The one piece of trigonometry the drag layer needs about a TURNED box.
//
// Ported from the predecessor's core/layout/free-rotation.ts, which held the
// whole free-rotation vocabulary — the angle's storage form, its spelling, the
// 15° ladder, the pivot. Rotation itself is a later tranche (free objects can
// be turned; a plate and a caption cannot), and none of that arrives here yet.
// What does arrive is the bounding box of a turned rectangle, because
// drag-geometry.ts's snapping already knows how to behave around a turned box
// (UAT 18C) and its tests prove it, and a snap layer that had to be re-taught
// that when rotation lands would be the same layer written twice.
//
// One reader, deliberately: the guide's REACH along a turned box. Nothing here
// stores an angle, and nothing else may read this to decide where an edge is —
// see rotatedBounds for why that would be a lie.

export interface RotatableRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Point {
  x: number;
  y: number;
}

/** A point turned about a centre, positive clockwise — CSS `rotate()`'s sense. */
export function rotatePointAbout(p: Point, centre: Point, deg: number): Point {
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = p.x - centre.x;
  const dy = p.y - centre.y;
  return {
    x: centre.x + dx * cos - dy * sin,
    y: centre.y + dx * sin + dy * cos,
  };
}

/** The four corners of a rectangle turned about its own centre. */
export function rotatedCorners(rect: RotatableRect, deg: number): Point[] {
  const c = { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
  const right = rect.x + rect.w;
  const bottom = rect.y + rect.h;
  return [
    rotatePointAbout({ x: rect.x, y: rect.y }, c, deg),
    rotatePointAbout({ x: right, y: rect.y }, c, deg),
    rotatePointAbout({ x: right, y: bottom }, c, deg),
    rotatePointAbout({ x: rect.x, y: bottom }, c, deg),
  ];
}

/**
 * The axis-aligned box that CONTAINS a turned one.
 *
 * ── WHAT THIS IS FOR, AND WHAT IT IS NOT FOR ──────────────────────────────
 * It is the honest answer to 「how far does this object's ink reach」, which is
 * the question a RULER asks (「measure margin in case of images falling out of
 * bounds」) and the question a trim audit asks. For a turned object the extreme
 * ink is at a corner, so the bounding box is exactly right for both.
 *
 * IT IS THE WRONG ANSWER TO 「where are this object's edges」, and every caller
 * has to know which of the two questions it is asking. It coincides with none of
 * the object's four edges at any angle that is not a multiple of 90 — so a snap
 * guide drawn along it would touch the object at ONE POINT while claiming an
 * alignment along its whole length, which is the defect guidesFor's grouping fix
 * had to correct once already. drag-geometry.ts therefore does not snap to
 * this, and says so; it reads it only for a guide's reach.
 *
 * COMPUTED FROM THE CORNERS rather than from the |w·cos| + |h·sin| identity,
 * which is the same number and is the wrong thing to write down: the identity is
 * only invertible when cos 2θ ≠ 0, and a later reader who found it here would
 * reasonably assume it could be run backwards to recover the frame — at 45°,
 * which is the angle people pick.
 */
export function rotatedBounds(rect: RotatableRect, deg: number): RotatableRect {
  if (!Number.isFinite(deg) || deg === 0) {
    return { x: rect.x, y: rect.y, w: rect.w, h: rect.h };
  }
  const corners = rotatedCorners(rect, deg);
  const xs = corners.map((p) => p.x);
  const ys = corners.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}
