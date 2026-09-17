// A frame: where a person put one part of an entry, as fractions of the PAGE.
//
// The one value in this system that a drag produces, and the one the engine
// re-applies on every derivation (principle 2). It is stored under
// `(catalogue, lot, field)` like every other correction — never under a slot,
// a page index or an element id — so the same frame lands on the same lot at
// four-up and at nine-up (principle 1). A density change moves the LOT; the
// frame says where on its page that lot's plate or title sits, and that
// sentence is as true on the new page as on the old one.
//
// ── PAGE FRACTIONS, NOT SLOT FRACTIONS ──────────────────────────────────────
//
// Carried from the predecessor's core/layout/frame-coords.ts, where three
// options were weighed and one chosen. A slot is a positional box that moves
// when perPage changes, so "0.5 of my slot" relocates with the grid and a
// human's placement would drift every time someone pressed 9-up — the geometry
// layer undoing the very thing the (lot, field) key exists to protect. A page
// fraction is anchored to the paper, which is what the specialist is looking
// at and what the printer receives.
//
// The predecessor then converted page fractions back into SLOT-relative frames
// at build time, because its tree contract said element frames were
// slot-relative and its renderer emitted them as percentages of the slot.
// This renderer has no such contract — a placed part is positioned against the
// page directly (src/lib/render/html.ts) — so the conversion, and the
// `escapesSlot` un-clipping it dragged in, are not needed here. The bound that
// IS kept is `intersectsPage`, for the reason stated on it.
//
// SHARED BY THE CLIENT AND THE SERVER. drag-geometry.ts refuses to send what
// this refuses to store, so a pointless round trip never leaves the browser
// and a frame that reaches the database has passed one predicate, not two that
// could disagree.

export interface OverrideFrame {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Fraction precision for a stored frame.
 *
 * Six decimals is not arbitrary: the renderer emits a frame as a CSS
 * percentage with four decimals — `(v * 100).toFixed(4)` — which is exactly
 * six decimals of fraction, so anything finer cannot reach the page and would
 * only make two writes of one drag differ in bytes nobody can see. On A4 one
 * unit here is 0.0002mm.
 */
export const FRAME_PRECISION = 1e6;

/** Round to the renderer's own resolution. See FRAME_PRECISION. */
export function roundFrame(f: OverrideFrame): OverrideFrame {
  return {
    x: Math.round(f.x * FRAME_PRECISION) / FRAME_PRECISION,
    y: Math.round(f.y * FRAME_PRECISION) / FRAME_PRECISION,
    w: Math.round(f.w * FRAME_PRECISION) / FRAME_PRECISION,
    h: Math.round(f.h * FRAME_PRECISION) / FRAME_PRECISION,
  };
}

/**
 * Does a frame put any of itself on the page?
 *
 * The one bound worth enforcing on a placement. Any part may go anywhere, and
 * bleeding past the trim is legitimate — a full-bleed plate does it by design —
 * so this is deliberately NOT a containment check. It rejects only a frame
 * that has left the paper entirely, which is an edit the human cannot see and
 * therefore cannot undo by dragging it back. Non-finite numbers fail it too,
 * because a NaN stored in jsonb is a frame nothing can ever paint or clear.
 */
export function intersectsPage(f: OverrideFrame): boolean {
  return (
    Number.isFinite(f.x) &&
    Number.isFinite(f.y) &&
    Number.isFinite(f.w) &&
    Number.isFinite(f.h) &&
    f.w > 0 &&
    f.h > 0 &&
    f.x < 1 &&
    f.y < 1 &&
    f.x + f.w > 0 &&
    f.y + f.h > 0
  );
}

/**
 * Read a stored frame, or null when what is stored is not one.
 *
 * ALL FOUR OR NOTHING. A half-written frame is not a smaller frame, it is a
 * corrupt one, and defaulting the missing half would invent a position nobody
 * chose. A zero or negative size is refused for the reason drag-geometry's
 * MIN_SIZE_PX exists: a part placed at no size can never be selected again.
 * Whether the frame is ON the page is a separate question, asked by the
 * engine with `intersectsPage` — a stored frame that has wandered off is kept
 * in the row and not applied, which is the predecessor's rule for an override
 * whose target is gone: never deleted behind the person's back, never
 * silently believed.
 */
export function frameFromValue(value: unknown): OverrideFrame | null {
  if (typeof value !== "object" || value === null) return null;
  const { x, y, w, h } = value as Record<string, unknown>;
  if (
    typeof x !== "number" ||
    typeof y !== "number" ||
    typeof w !== "number" ||
    typeof h !== "number"
  ) {
    return null;
  }
  if (![x, y, w, h].every(Number.isFinite)) return null;
  if (!(w > 0) || !(h > 0)) return null;
  return { x, y, w, h };
}
