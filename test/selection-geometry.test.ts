// Tests for the selection overlay's pure half (v0.2.2, E1). The component that
// uses these cannot be rendered in this environment (node vitest, no jsdom), so
// these functions ARE the overlay's testable surface — the same arrangement
// panel-state.test.ts describes.

import { describe, expect, it } from "vitest";

import {
  growthMark,
  identityFrom,
  parseDesignedHeight,
  pinAnchor,
  pinPoint,
  sameMarks,
  sameRings,
  sameSelection,
  selectionKey,
  toOverlayRect,
  verticalClearance,
  type GrowthMark,
  type OverlayRect,
  type SelectionRing,
} from "@/lib/editor/selection-geometry";

// ── Coordinates ──────────────────────────────────────────────────────────────

describe("toOverlayRect", () => {
  it("adds the iframe's border inset, which is where a 1px drift comes from", () => {
    // The overlay layer is `absolute inset-0` over the iframe, so its origin is
    // the iframe's BORDER box, while the child's rects start at the CONTENT box.
    // The editor's preview frame is `border border-slate-300` — 1px — so without
    // this the ring paints one pixel high and left of the box it rings, on every
    // element, forever, and it looks like a rounding bug rather than a constant.
    const r = toOverlayRect(
      { left: 222, top: 92, width: 658, height: 120 },
      { x: 1, y: 1 },
    );
    expect(r).toEqual({ x: 223, y: 93, w: 658, h: 120 });
  });

  it("needs no parent-document coordinates at all", () => {
    // Measured from the running app: the first element sits at (222, 92) inside
    // the child document while the iframe itself sits at (168, 365) in the parent.
    // Those 168/365 must NOT appear in the conversion — the layer is placed over
    // the frame by CSS, so the parent's position is already accounted for. Adding
    // it was the first thing this file was written to rule out: it puts every
    // ring exactly one iframe-offset down and to the right, which reads as "the
    // overlay is broken" rather than "someone added a number twice".
    const r = toOverlayRect({ left: 222, top: 92, width: 658, height: 120 }, { x: 0, y: 0 });
    expect(r.x).toBe(222);
    expect(r.y).toBe(92);
  });

  it("keeps a scrolled-past element NEGATIVE rather than adding scroll back", () => {
    // Screen mode renders all 43 pages in one vertical flow inside the frame, so
    // the preview scrolls constantly. getBoundingClientRect() in the child is
    // already relative to the child's viewport, so page 30's rect is a large
    // negative number when page 40 is on screen. Adding scrollY here — the
    // obvious-looking "account for the iframe's internal scroll" fix — would
    // double it and fling every ring off the top of the page.
    const r = toOverlayRect(
      { left: 40, top: -8400, width: 300, height: 60 },
      { x: 1, y: 1 },
    );
    expect(r.y).toBe(-8399);
    // The layer clips (overflow-hidden), so an off-screen ring simply does not
    // paint. Its SIZE must survive untouched, or it would come back wrong when
    // the specialist scrolls to it.
    expect(r.w).toBe(300);
    expect(r.h).toBe(60);
  });
});

// ── Identity ─────────────────────────────────────────────────────────────────

describe("identityFrom", () => {
  it("pairs the slot's lot id with the element's field", () => {
    expect(identityFrom("lot-7", "title")).toEqual({ lotId: "lot-7", field: "title" });
  });

  it("refuses an element with no lot — including data-lot=\"\"", () => {
    // A page number, a divider, or a structural slot has no (lotId, field) to be
    // keyed by, so no override could ever be written for it. Returning an
    // identity here would offer the specialist a selection whose edits silently
    // cannot be saved — and an empty attribute is not a lot whose id is "".
    expect(identityFrom(null, "ref")).toBeNull();
    expect(identityFrom("", "ref")).toBeNull();
    expect(identityFrom("   ", "ref")).toBeNull();
  });

  it("refuses an element with no field", () => {
    // `.el-text` and `.el-divider` carry no data-field. They are painted, they
    // are enumerable, and they are not selectable — the same rule from the other
    // side.
    expect(identityFrom("lot-7", null)).toBeNull();
    expect(identityFrom("lot-7", "")).toBeNull();
  });

  it("trims, so an attribute reformatted with whitespace still resolves", () => {
    expect(identityFrom(" lot-7 ", " title ")).toEqual({
      lotId: "lot-7",
      field: "title",
    });
  });
});

describe("selectionKey", () => {
  it("cannot collide across a separator that appears in an id", () => {
    // The naive `${lotId}-${field}` gives BOTH of these the key "a-b-c", so
    // React would paint one ring for two different elements and the second would
    // vanish. Lot ids are uuids today; that is exactly the sort of "cannot
    // happen" that stops being true when the id source changes.
    const a = selectionKey({ lotId: "a-b", field: "c" });
    const b = selectionKey({ lotId: "a", field: "b-c" });
    expect(a).not.toBe(b);
  });

  it("is stable for the same identity", () => {
    // The key is a React key: an identity that keys differently on two renders
    // would unmount and remount its ring, which is a flicker on every scroll
    // frame.
    expect(selectionKey({ lotId: "lot-1", field: "maker" })).toBe(
      selectionKey({ lotId: "lot-1", field: "maker" }),
    );
  });
});

describe("sameSelection", () => {
  it("compares both halves", () => {
    const sel = { lotId: "lot-1", field: "title" };
    expect(sameSelection(sel, { lotId: "lot-1", field: "title" })).toBe(true);
    // Same field on a DIFFERENT lot is the case that matters: every lot in the
    // catalogue has a "title", so comparing only the field would ring all 43.
    expect(sameSelection(sel, { lotId: "lot-2", field: "title" })).toBe(false);
    expect(sameSelection(sel, { lotId: "lot-1", field: "maker" })).toBe(false);
  });

  it("treats null as no selection, never as a match", () => {
    // Two deselected states are not "the same selection" — if they were, the
    // component's "did the selection change?" check would skip the re-measure
    // that clears the ring.
    expect(sameSelection(null, null)).toBe(false);
    expect(sameSelection({ lotId: "lot-1", field: "title" }, null)).toBe(false);
  });
});

// ── Repaint ──────────────────────────────────────────────────────────────────

describe("sameRings", () => {
  const ring = (over: Partial<SelectionRing> = {}): SelectionRing => ({
    key: '["lot-1","title"]',
    kind: "selected",
    rect: { x: 10, y: 20, w: 100, h: 30 },
    ...over,
  });

  it("says nothing changed when nothing changed", () => {
    // This is what stops a setState per scroll frame. The overlay re-measures on
    // every scroll event; with nothing selected both lists are empty, and a fresh
    // [] would still be a new object and would still re-render, 60 times a second,
    // to paint the same nothing.
    expect(sameRings([], [])).toBe(true);
    expect(sameRings([ring()], [ring()])).toBe(true);
  });

  it("catches a sub-pixel move, because that IS the page scrolling", () => {
    // A tolerance here would look like a sensible optimisation and would show up
    // as a ring that drifts away from its element during a slow scroll.
    expect(sameRings([ring()], [ring({ rect: { x: 10.5, y: 20, w: 100, h: 30 } })])).toBe(
      false,
    );
  });

  it("catches a change of kind or of identity at the same position", () => {
    // Hover → selected happens at EXACTLY the same rectangle (you click the thing
    // you were hovering), so comparing geometry alone would leave the whisper
    // painted and never draw the ring.
    expect(sameRings([ring()], [ring({ kind: "hover" })])).toBe(false);
    expect(sameRings([ring()], [ring({ key: '["lot-2","title"]' })])).toBe(false);
  });

  it("catches a ring appearing or disappearing", () => {
    expect(sameRings([], [ring()])).toBe(false);
    expect(sameRings([ring()], [])).toBe(false);
  });
});

// ── Auto-grow marking (E4) ───────────────────────────────────────────────────
//
// The numbers below are the real ones. A 4-up A4 preview at the shooter's
// viewport paints the page 1122.5px tall; a weight-1 field row at grid-4 is
// 3.2mm × 0.9 × 1.45 = 4.176mm, which is 4.176/297 = 0.014061 of the page — the
// exact fraction render-html publishes as data-min-h — and 15.78px on that page.

const PAGE_H = 1122.5;
/** grid-4's weight-1 row, as the renderer publishes it. */
const ONE_ROW = 0.014061;
const ONE_ROW_PX = ONE_ROW * PAGE_H; // 15.78

describe("parseDesignedHeight", () => {
  it("reads the fraction the renderer published", () => {
    expect(parseDesignedHeight("0.014061")).toBeCloseTo(0.014061, 9);
  });

  it("treats an ABSENT attribute as unknown, never as zero", () => {
    // A plate, a page number, and every catalogue rendered before E4 landed.
    // Zero would make each of them "designed to be 0mm tall", i.e. grown by their
    // entire height — an amber band over every picture in the document.
    expect(parseDesignedHeight(null)).toBeNull();
    expect(parseDesignedHeight(undefined)).toBeNull();
    expect(parseDesignedHeight("")).toBeNull();
    expect(parseDesignedHeight("nonsense")).toBeNull();
    expect(parseDesignedHeight("0")).toBeNull();
    expect(parseDesignedHeight("-0.5")).toBeNull();
  });
});

describe("growthMark", () => {
  const rect = (h: number) => ({ x: 40, y: 200, w: 330, h });

  it("says nothing when the box is exactly its designed height", () => {
    expect(growthMark("k", rect(ONE_ROW_PX), ONE_ROW, PAGE_H)).toBeNull();
  });

  it("marks ONLY the strip past the design, not the whole box", () => {
    // The box is fine; the last line of it is the part that had to come from
    // somewhere and may now be sitting on the field below. Outlining the element
    // would say "something is wrong with this caption", which is neither what
    // happened nor something a specialist can act on.
    const grown = growthMark("k", rect(ONE_ROW_PX * 2), ONE_ROW, PAGE_H);
    expect(grown).not.toBeNull();
    expect(grown!.rect.y).toBeCloseTo(200 + ONE_ROW_PX, 6);
    expect(grown!.rect.h).toBeCloseTo(ONE_ROW_PX, 6);
    // Same column as the box it annotates.
    expect(grown!.rect.x).toBe(40);
    expect(grown!.rect.w).toBe(330);
    expect(grown!.overflowPx).toBeCloseTo(ONE_ROW_PX, 6);
  });

  it("ignores sub-pixel disagreement, which is all 280 rows or none", () => {
    // designedH is a page fraction multiplied by a MEASURED page box, so it lands
    // a fraction of a pixel off even when renderer and browser agree exactly. A
    // warning on every field row is the same as no warning at all.
    expect(growthMark("k", rect(ONE_ROW_PX + 0.4), ONE_ROW, PAGE_H)).toBeNull();
    expect(growthMark("k", rect(ONE_ROW_PX + 0.99), ONE_ROW, PAGE_H)).toBeNull();
    // The smallest growth that CAN happen is a whole line — 15.78px here — so the
    // gap between the epsilon and a real event is four hundred times the epsilon.
    // (Not asserted at exactly +1: the boundary is a float comparison against a
    // product of a fraction and a measured page, and it lands either side of
    // itself by 1e-15. Testing a boundary that cannot be hit in practice would be
    // testing arithmetic, not behaviour.)
    expect(growthMark("k", rect(ONE_ROW_PX + 1.5), ONE_ROW, PAGE_H)).not.toBeNull();
    expect(growthMark("k", rect(ONE_ROW_PX * 2), ONE_ROW, PAGE_H)).not.toBeNull();
  });

  it("never marks a box that has no published design, or an unlaid page", () => {
    expect(growthMark("k", rect(999), null, PAGE_H)).toBeNull();
    // A page box of zero is "not laid out yet", which would otherwise make every
    // element infinitely grown on the first frame after a navigation.
    expect(growthMark("k", rect(999), ONE_ROW, 0)).toBeNull();
  });

  it("scales with the page, so the answer is the same at any zoom", () => {
    // The editor canvas scales the frame with a CSS transform, and the child's
    // own rects stay in unscaled child pixels — but the preview is also fluid, so
    // the same catalogue measures differently in a narrow panel. Publishing a
    // FRACTION rather than a length is what makes both cases one case.
    const half = growthMark("k", rect(ONE_ROW_PX), ONE_ROW * 2, PAGE_H / 2);
    expect(half).toBeNull(); // designed 15.78px, painted 15.78px — still exact
  });
});

// ── The toolbar's room to stand (session 16, #13) ────────────────────────────

describe("verticalClearance", () => {
  // One lot's caption stack on a 1-up page: a title, then the row this is all
  // about, then the material line. Real proportions — a caption row is ~15px in
  // the preview and the rows abut.
  const PAGE = { top: 40, bottom: 1160 };
  const title: OverlayRect = { x: 60, y: 700, w: 400, h: 22 };
  const row: OverlayRect = { x: 60, y: 728, w: 400, h: 15 };
  const material: OverlayRect = { x: 60, y: 760, w: 400, h: 15 };
  /** What a toolbar needs, in the page's own pixels — see TOOLBAR_BAND_PX. */
  const BAR = 44;

  it("reports the gap to the neighbours, not to the paper", () => {
    const clear = verticalClearance(row, [title, material], PAGE, BAR);
    expect(clear.above).toBeCloseTo(6, 6); // 728 − (700+22)
    expect(clear.below).toBeCloseTo(17, 6); // 760 − (728+15)
  });

  it("falls back to the page when nothing is beside it", () => {
    const clear = verticalClearance(row, [], PAGE, BAR);
    expect(clear.above).toBeCloseTo(688, 6);
    expect(clear.below).toBeCloseTo(417, 6);
    // Nothing in the way ⇒ nothing to travel past.
    expect(clear.liftAbove).toBe(0);
    expect(clear.liftBelow).toBe(0);
  });

  it("does not ask a bar to move when the adjacent gap already holds it", () => {
    const clear = verticalClearance(row, [title, material], PAGE, 5);
    expect(clear.liftAbove).toBe(0); // 6px gap, 5px wanted
    expect(clear.liftBelow).toBe(0);
  });

  it("travels PAST an abutting run to the first band that holds the bar", () => {
    // The photographed page: eight caption rows that abut exactly, with 29px of
    // paper between the plate above and the first of them. Selecting row two,
    // there is nowhere adjacent to stand — and somewhere two rows up.
    const plate: OverlayRect = { x: 60, y: 300, w: 400, h: 384 }; // …684
    const rows: OverlayRect[] = Array.from({ length: 8 }, (_, i) => ({
      x: 60,
      y: 713 + i * 18,
      w: 400,
      h: 18,
    }));
    const target = rows[1]!;
    const others = [plate, ...rows.filter((r) => r !== target)];
    const clear = verticalClearance(target, others, { top: 40, bottom: 1160 }, 27);
    expect(clear.above).toBe(0); // the row above abuts
    // …but 18px up — past that row — is the 29px band between plate and caption.
    expect(clear.liftAbove).toBeCloseTo(18, 6);
    // Downward, the first band is the page's own foot: six rows away.
    expect(clear.liftBelow).toBeCloseTo(6 * 18, 6);
  });

  it("refuses a band that is out of reach rather than sending the bar to the margin", () => {
    // A row deep inside a very long stack. Somewhere on the sheet is empty, and
    // a toolbar that travelled there would be a control pointing at nothing.
    const rows: OverlayRect[] = Array.from({ length: 40 }, (_, i) => ({
      x: 60,
      y: 100 + i * 18,
      w: 400,
      h: 18,
    }));
    const target = rows[20]!;
    const others = rows.filter((r) => r !== target);
    const clear = verticalClearance(target, others, { top: 40, bottom: 1160 }, 44, 120);
    expect(clear.liftAbove).toBeNull();
    expect(clear.liftBelow).toBeNull();
    // …and with no limit, the same page does have somewhere.
    const far = verticalClearance(target, others, { top: 40, bottom: 1160 }, 44);
    expect(far.liftBelow).toBeGreaterThan(120);
  });

  it("ignores the next COLUMN, which is not in the bar's way", () => {
    // 4-up. A caption in the right-hand column shares no horizontal ground with
    // this one, and counting it would report zero room on every multi-column
    // page and flip every bar to the bottom of the canvas.
    const otherColumn: OverlayRect = { x: 500, y: 600, w: 300, h: 200 };
    const clear = verticalClearance(row, [otherColumn], PAGE, BAR);
    expect(clear.above).toBeCloseTo(688, 6);
  });

  it("takes the NEAREST neighbour on each side", () => {
    const far: OverlayRect = { x: 60, y: 300, w: 400, h: 20 };
    expect(verticalClearance(row, [far, title], PAGE, BAR).above).toBeCloseTo(6, 6);
    expect(verticalClearance(row, [title, far], PAGE, BAR).above).toBeCloseTo(6, 6);
  });

  it("never reports a negative room, which would read as a very large one", () => {
    // E4 lets a grown box overlap the row beneath it, so this is a real page and
    // not a hypothetical: a negative clearance multiplied by a zoom is a number
    // every comparison below reads as "plenty of space".
    const grown: OverlayRect = { x: 60, y: 700, w: 400, h: 40 };
    const clear = verticalClearance(row, [grown], PAGE, BAR);
    expect(clear.above).toBe(0);
    expect(clear.below).toBeGreaterThanOrEqual(0);
  });

  it("does not call an abutting row a neighbour a fraction of a pixel away", () => {
    // Frames are fractions multiplied by a measured page, so two rows that abut
    // exactly land a hair apart. Without the tolerance a row 0.4px below would
    // count as "beside" rather than "below" and the clearance would be the whole
    // sheet — which is precisely the wrong answer, confidently.
    const abutting: OverlayRect = { x: 60, y: 743.4, w: 400, h: 15 };
    expect(verticalClearance(row, [abutting], PAGE, BAR).below).toBeCloseTo(0.4, 6);
  });
});

// ── Where a comment mark hangs (session 16, #12) ─────────────────────────────

describe("pinAnchor", () => {
  // A `fit-bottom` plate: the frame is the recommended area, the picture sits at
  // the bottom of it, and the slack above is what the mark used to float in.
  const frame: OverlayRect = { x: 60, y: 100, w: 400, h: 500 };
  const picture: OverlayRect = { x: 60, y: 380, w: 400, h: 220 };

  it("hangs off the artwork, not off the empty top of the frame", () => {
    const anchor = pinAnchor(frame, picture);
    expect(anchor.y).toBe(380);
    // 280px lower on the page — which on this plate is the difference between a
    // mark on the photograph's corner and a mark alone in the top margin.
    expect(pinPoint(anchor).y - pinPoint(frame).y).toBeCloseTo(280, 6);
    // …and still on the same edge, so the mark stays clear of the `ne` handle.
    expect(pinPoint(anchor).x).toBe(pinPoint(frame).x);
  });

  it("stays inside the frame, because the frame is what clips", () => {
    // A subject-placed <img> is deliberately larger than its frame and offset
    // outside it. A mark against an edge that is not on the page is the same
    // defect pointing the other way.
    const bleeding: OverlayRect = { x: -200, y: -300, w: 1200, h: 1400 };
    expect(pinAnchor(frame, bleeding)).toEqual(frame);
  });

  it("is the element itself for anything that is not a picture", () => {
    expect(pinAnchor(frame, null)).toBe(frame);
    // Disjoint boxes: no intersection to mark, so the frame answers.
    expect(pinAnchor(frame, { x: 900, y: 900, w: 10, h: 10 })).toBe(frame);
  });
});

describe("sameMarks", () => {
  const mark = (over: Partial<GrowthMark> = {}): GrowthMark => ({
    key: '0:["lot-1","sealMarks"]',
    rect: { x: 40, y: 216, w: 330, h: 15.78 },
    overflowPx: 15.78,
    ...over,
  });

  it("stops a setState per scroll frame when nothing moved", () => {
    expect(sameMarks([], [])).toBe(true);
    expect(sameMarks([mark()], [mark()])).toBe(true);
  });

  it("catches a mark moving, appearing or changing element", () => {
    expect(
      sameMarks([mark()], [mark({ rect: { x: 40, y: 217, w: 330, h: 15.78 } })]),
    ).toBe(false);
    expect(sameMarks([], [mark()])).toBe(false);
    expect(sameMarks([mark()], [mark({ key: '1:["lot-2","title"]' })])).toBe(false);
  });
});
