// The canvas arithmetic (session 4, E5). Tested rather than looked at, for the
// same reason the gesture arithmetic is: none of these mistakes throws. A zoom
// that drifts, a rail that highlights the wrong page and a toolbar that stands
// on a plate all render perfectly well.

import { describe, expect, it } from "vitest";

import {
  anchoredScroll,
  clampZoom,
  currentPageIndex,
  fitZoom,
  FRAME_BASE_W,
  frameWidth,
  pageFitZoom,
  pageScrollTop,
  revealPlan,
  toolbarSpot,
  wheelZoom,
  ZOOM_MAX,
  ZOOM_MIN,
} from "@/lib/editor/canvas-geometry";
import type { AnchorRect, OverlayRect } from "@/lib/editor/selection-geometry";

describe("zoom", () => {
  it("clamps to the usable band and survives nonsense", () => {
    expect(clampZoom(1)).toBe(1);
    expect(clampZoom(99)).toBe(ZOOM_MAX);
    expect(clampZoom(0.001)).toBe(ZOOM_MIN);
    // NaN reaches this from a division by a not-yet-measured canvas, and a NaN
    // zoom silently disables every scroll position computed from it.
    expect(clampZoom(Number.NaN)).toBe(1);
  });

  it("fits the page to the canvas width", () => {
    expect(fitZoom(FRAME_BASE_W)).toBe(1);
    expect(fitZoom(FRAME_BASE_W / 2)).toBeCloseTo(0.5, 6);
    // Before the ResizeObserver has reported anything. Zero would poison every
    // scroll position derived from it.
    expect(fitZoom(0)).toBe(1);
  });

  it("fits a WHOLE page, which is a different number from fitting the width", () => {
    // The screen this was found on: a 1440px window with the rail and no
    // inspector leaves ~1355px of canvas over 900px of height, and screen mode
    // lays A4 out at 1122px tall inside the 826px frame.
    const A4_TALL = 1122.5;
    expect(fitZoom(1355)).toBeCloseTo(1.64, 2); // 164%: under half a sheet
    const page = pageFitZoom(1355, 900, A4_TALL);
    expect(page).toBeLessThan(fitZoom(1355));
    // The whole sheet AND its air fit in the canvas — that is the promise the
    // button's label makes, and the only thing worth asserting about it.
    expect(A4_TALL * page + 32 * page).toBeLessThanOrEqual(900 + 1e-9);
    expect(page).toBeCloseTo(900 / (A4_TALL + 32), 6);
  });

  it("never exceeds the width fit, however short the paper", () => {
    // A wide canvas over a nearly-square page: the height stops binding and the
    // width has to, or the page runs off the sides of a control called "fit".
    expect(pageFitZoom(826, 4000, 300)).toBe(fitZoom(826));
  });

  it("falls back to the width fit before the document has been measured", () => {
    // The frame has not navigated, so there is no `.page` to measure. The button
    // must still do the sensible thing rather than clamp to the zoom floor.
    expect(pageFitZoom(1355, 900, 0)).toBe(fitZoom(1355));
    expect(pageFitZoom(1355, 900, Number.NaN)).toBe(fitZoom(1355));
    expect(pageFitZoom(1355, 0, 1122.5)).toBe(fitZoom(1355));
  });

  it("steps multiplicatively, so a notch means the same thing at any zoom", () => {
    const inA = wheelZoom(1, -100) / 1;
    const inB = wheelZoom(2, -100) / 2;
    expect(inA).toBeCloseTo(inB, 10);
    // Wheel DOWN zooms out, wheel UP zooms in — the sign convention every other
    // canvas on the machine uses.
    expect(wheelZoom(1, 100)).toBeLessThan(1);
    expect(wheelZoom(1, -100)).toBeGreaterThan(1);
  });
});

describe("frameWidth", () => {
  // STILL UNCALLED. Tested anyway, because the number is the load-bearing part
  // of a spread and the comment above it is where the argument lives: a
  // narrower column would halve the type and re-break every CJK line, which is
  // the layout the specialist pressed the toggle to judge. What is missing is
  // in the renderer — this renderer stacks sheets one per row — and is written
  // down beside the function.
  it("is one sheet's footprint at one-up and exactly two at two-up", () => {
    expect(frameWidth(false)).toBe(FRAME_BASE_W);
    expect(frameWidth(true)).toBe(FRAME_BASE_W * 2);
  });

  it("keeps 100% honest in both arrangements", () => {
    // `zoom = 1` means the arrangement at its physical size. A4 at the CSS
    // reference 96dpi is 210/25.4*96 = 793.7px, and the preview's body gives
    // the sheet 16px of air a side — so a one-up frame reaches the cap with
    // 32px to spare and a two-up frame reaches it twice.
    const A4_PX = (210 / 25.4) * 96;
    expect(frameWidth(false) - 32).toBeGreaterThanOrEqual(A4_PX);
    expect(frameWidth(false) - 32 - A4_PX).toBeLessThan(1);
    expect(fitZoom(frameWidth(true), frameWidth(true))).toBe(1);
  });
});

describe("anchoredScroll", () => {
  const from = { zoom: 1, left: 120, top: 400 };

  it("is a no-op when the zoom does not change", () => {
    expect(anchoredScroll(from, 1, { x: 300, y: 250 })).toEqual({
      left: 120,
      top: 400,
    });
  });

  it("keeps the point under the cursor under the cursor", () => {
    const cursor = { x: 300, y: 250 };
    const to = 2;
    const next = anchoredScroll(from, to, cursor);
    // Horizontal: the cursor's offset inside the canvas before and after.
    expect(cursor.x * to - next.left).toBeCloseTo(cursor.x * from.zoom - from.left, 6);
    // Vertical: the DOCUMENT point under the cursor before and after. The child
    // coordinate shrinks as the frame's layout height does, so the scroll has to
    // absorb the difference.
    const childYAfter = (cursor.y * from.zoom) / to;
    expect(next.top + childYAfter).toBeCloseTo(from.top + cursor.y, 6);
  });

  it("never asks for a negative scroll", () => {
    // Zooming out near the origin: the anchoring arithmetic wants to scroll left
    // of the paper, which the browser clamps silently — so clamp it here, where
    // the number can still be reasoned about.
    const next = anchoredScroll({ zoom: 2, left: 0, top: 0 }, 0.5, { x: 10, y: 10 });
    expect(next.left).toBeGreaterThanOrEqual(0);
    expect(next.top).toBeGreaterThanOrEqual(0);
  });
});

describe("currentPageIndex", () => {
  // Three A4 pages in one flow, roughly what screen mode emits at 826px.
  const tops = [16, 1180, 2344];

  it("is the first page at rest", () => {
    expect(currentPageIndex(tops, 0, 900)).toBe(0);
  });

  it("advances only once the next page owns the upper third", () => {
    // Page 2's top is just below the pick line: still page 1.
    expect(currentPageIndex(tops, 850, 900)).toBe(0);
    expect(currentPageIndex(tops, 900, 900)).toBe(1);
    expect(currentPageIndex(tops, 2100, 900)).toBe(2);
  });

  it("survives an unmeasured document", () => {
    expect(currentPageIndex([], 500, 900)).toBe(0);
  });

  it("puts a page under the top of the frame", () => {
    expect(pageScrollTop(tops, 1)).toBe(1164);
    // Clamped both ways: the rail is built from the tree's page count and the
    // measured document can lag it by one render.
    expect(pageScrollTop(tops, 99)).toBe(2328);
    expect(pageScrollTop(tops, -3)).toBe(0);
  });
});

describe("toolbarSpot", () => {
  const view = { w: 1000, h: 800, scrollLeft: 0 };
  const size = { w: 200, h: 32 };

  it("stands above the selection when there is room", () => {
    const rect: OverlayRect = { x: 100, y: 300, w: 200, h: 100 };
    const spot = toolbarSpot(rect, 1, view, size, 10);
    expect(spot).not.toBeNull();
    // Clear of the ring, not on it.
    expect(spot!.y + size.h).toBeLessThanOrEqual(rect.y);
    // Centred on the ring.
    expect(spot!.x + size.w / 2).toBeCloseTo(rect.x + rect.w / 2, 6);
  });

  it("drops below when the selection is against the top", () => {
    const rect: OverlayRect = { x: 100, y: 4, w: 200, h: 100 };
    const spot = toolbarSpot(rect, 1, view, size, 10);
    expect(spot!.y).toBeGreaterThanOrEqual(rect.y + rect.h);
  });

  it("pins to the canvas edge when the selection fills the view", () => {
    // A full-bleed plate at any real zoom: there is no "outside" on screen.
    const rect: OverlayRect = { x: 0, y: -200, w: 800, h: 1400 };
    const spot = toolbarSpot(rect, 1, view, size, 10);
    expect(spot!.y + size.h).toBeLessThanOrEqual(view.h);
    expect(spot!.y).toBeGreaterThan(view.h / 2);
  });

  it("disappears with a selection that has scrolled away", () => {
    // Otherwise the bar sits at the edge of the canvas offering 還原位置 for a
    // lot forty pages up.
    expect(toolbarSpot({ x: 0, y: -900, w: 200, h: 100 }, 1, view, size)).toBeNull();
    expect(toolbarSpot({ x: 0, y: 1200, w: 200, h: 100 }, 1, view, size)).toBeNull();
  });

  it("keeps clear of the zoom bar's strip", () => {
    // Photographed, not reasoned: with the inspector open and a plate selected
    // at 302%, the pinned bar landed exactly on the zoom controls. Both the
    // pinned case and the "below" case have to respect the reserved band.
    const reserved = { w: 1000, h: 800, scrollLeft: 0, reserveBottom: 48 };
    const filling: OverlayRect = { x: 0, y: -200, w: 800, h: 1400 };
    expect(toolbarSpot(filling, 1, reserved, size, 10)!.y + size.h).toBeLessThanOrEqual(
      800 - 48,
    );
    // The "below" branch too, and this rectangle is chosen to discriminate: the
    // bar fits below the ring within the full 800, so an unreserved canvas puts
    // it at 740–772 — inside the zoom bar's strip. Reserved, it must give up on
    // "below" and pin above the band instead.
    const tall: OverlayRect = { x: 100, y: 0, w: 200, h: 730 };
    expect(toolbarSpot(tall, 1, { w: 1000, h: 800, scrollLeft: 0 }, size, 10)!.y).toBe(
      740,
    );
    expect(toolbarSpot(tall, 1, reserved, size, 10)!.y + size.h).toBeLessThanOrEqual(
      800 - 48,
    );
  });

  // ── The clearance (session 16, #13) ────────────────────────────────────────
  // Every case above passes NO clearance, which is the "unknown" contract: the
  // bar must behave exactly as it did before this existed. These are the cases
  // where the page has an opinion.

  it("flips below when the space above belongs to the row above it", () => {
    // The photograph that started this: a caption row with the previous row
    // abutting it. There is 300px of CANVAS above, which is what the old rule
    // looked at, and none of it is free.
    const wedged: AnchorRect = {
      x: 100,
      y: 300,
      w: 200,
      h: 14,
      clear: { above: 0, below: 120, liftAbove: null, liftBelow: 0 },
    };
    const spot = toolbarSpot(wedged, 1, view, size, 10);
    expect(spot!.y).toBeGreaterThanOrEqual(wedged.y + wedged.h);
    // Reported, so a live audit can ask instead of measuring pixels.
    expect(spot!.side).toBe("below");
  });

  it("still prefers above when the page above is genuinely empty", () => {
    const roomy: AnchorRect = {
      x: 100,
      y: 300,
      w: 200,
      h: 14,
      clear: { above: 90, below: 90, liftAbove: 0, liftBelow: 0 },
    };
    expect(toolbarSpot(roomy, 1, view, size, 10)!.y + size.h).toBeLessThanOrEqual(300);
    expect(toolbarSpot(roomy, 1, view, size, 10)!.side).toBe("above");
  });

  it("rises PAST the rows it would stand on, to the band that is free", () => {
    // The wedged caption row, with the page's real answer: 18px further up —
    // past the row above — is the paper between the plate and the caption. The
    // bar goes there and covers nothing at all, which is the whole complaint.
    const wedged: AnchorRect = {
      x: 100,
      y: 300,
      w: 200,
      h: 18,
      clear: { above: 0, below: 0, liftAbove: 18, liftBelow: 108 },
    };
    const spot = toolbarSpot(wedged, 1, view, size, 10);
    expect(spot!.side).toBe("above");
    // Its foot clears the row above (at 300 − 18) rather than sitting on it.
    expect(spot!.y + size.h).toBeLessThanOrEqual(300 - 18);
  });

  it("takes the nearer band, not the higher one", () => {
    const nearerBelow: AnchorRect = {
      x: 100,
      y: 300,
      w: 200,
      h: 18,
      clear: { above: 0, below: 0, liftAbove: 90, liftBelow: 18 },
    };
    expect(toolbarSpot(nearerBelow, 1, view, size, 10)!.side).toBe("below");
  });

  it("scales the lift, because the page is measured in child pixels", () => {
    // 40 child pixels of travel is 16 on the glass at 40% and 80 at 200%. A lift
    // added unscaled would leave the bar sitting on the very row it rose past.
    const rect: AnchorRect = {
      x: 100,
      y: 300,
      w: 200,
      h: 18,
      clear: { above: 0, below: 0, liftAbove: 40, liftBelow: 400 },
    };
    for (const z of [0.4, 1, 2]) {
      const spot = toolbarSpot(rect, z, { w: 1000, h: 4000, scrollLeft: 0 }, size, 10);
      expect(spot!.y + size.h).toBeLessThanOrEqual(300 * z - 40 * z);
    }
  });

  it("stands beside the selection when the page offers nowhere in reach", () => {
    // Deep inside a long stack. It must not give up and pin itself to the canvas
    // edge — that is a bar that has stopped pointing at its selection — so it
    // falls back to the adjacent placement and covers a row.
    const buried: AnchorRect = {
      x: 100,
      y: 300,
      w: 200,
      h: 14,
      clear: { above: 0, below: 0, liftAbove: null, liftBelow: null },
    };
    const spot = toolbarSpot(buried, 1, view, size, 10);
    expect(spot!.side).toBe("above");
    expect(spot!.y).toBe(300 - 10 - size.h);
    // …and when the two bad choices differ, it takes the less bad one: covering
    // 2px of a neighbour beats covering 12.
    const lopsided: AnchorRect = {
      ...buried,
      clear: { above: 2, below: 12, liftAbove: null, liftBelow: null },
    };
    expect(toolbarSpot(lopsided, 1, view, size, 10)!.side).toBe("below");
  });

  it("keeps the viewport as the hard constraint, the clearance as a preference", () => {
    // Clear page above, but that page is off the top of the canvas: a bar there
    // would be invisible. On screen wins.
    const high: AnchorRect = {
      x: 100,
      y: 4,
      w: 200,
      h: 100,
      clear: { above: 400, below: 0, liftAbove: 0, liftBelow: 0 },
    };
    expect(toolbarSpot(high, 1, view, size, 10)!.y).toBeGreaterThanOrEqual(104);
    // And the reserved band still wins over a clear page below.
    const reserved = { w: 1000, h: 800, scrollLeft: 0, reserveBottom: 48 };
    const low: AnchorRect = {
      x: 100,
      y: 0,
      w: 200,
      h: 730,
      clear: { above: 0, below: 400, liftAbove: null, liftBelow: 0 },
    };
    expect(toolbarSpot(low, 1, reserved, size, 10)!.y + size.h).toBeLessThanOrEqual(752);
  });

  it("scales with the zoom and stays inside a panned canvas", () => {
    const rect: OverlayRect = { x: 20, y: 300, w: 40, h: 40 };
    const spot = toolbarSpot(rect, 2, { w: 1000, h: 800, scrollLeft: 500 }, size, 10);
    // Footprint coordinates, so the ring's own position is in scaled pixels and
    // the clamp is against the PANNED window, not against the paper.
    expect(spot!.x).toBeGreaterThanOrEqual(500);
    expect(spot!.x + size.w).toBeLessThanOrEqual(1500);
    expect(spot!.y + size.h).toBeLessThanOrEqual(rect.y * 2);
  });
});

describe("revealPlan — the box a gesture is about must be ON the glass (item 9)", () => {
  // THE FILED CASE, in the numbers Chromium reported. A T7 (full-bleed) plate in
  // a 1440×900 window: the canvas is 984×852 and 符合寬度 computes 119.13%, so an
  // A4 sheet 1122.5 child pixels tall is drawn 1337 screen pixels tall. Six of
  // the eight handles were off the glass — the four along the bottom by 485px.
  const T7 = { x: 16.2, y: 0, w: 793.7, h: 1122.5 };
  const CANVAS = { w: 984, h: 852 };
  const FIT_W = 1.1913;

  it("pulls back until the whole plate and its handles fit", () => {
    const plan = revealPlan(T7, CANVAS, FIT_W);
    expect(plan.zoom).toBeLessThan(FIT_W);
    // Both axes, with the pad on each side, inside the canvas.
    expect(T7.h * plan.zoom).toBeLessThanOrEqual(CANVAS.h);
    expect(T7.w * plan.zoom).toBeLessThanOrEqual(CANVAS.w);
    // The height binds on a portrait sheet in a landscape canvas.
    expect(T7.h * plan.zoom).toBeCloseTo(CANVAS.h - 48, 3);
  });

  it("centres the plate vertically, as a delta the caller adds to scrollY", () => {
    const plan = revealPlan(T7, CANVAS, FIT_W);
    // The visible child band at the new zoom, and the box centred in it.
    const band = CANVAS.h / plan.zoom;
    expect(plan.scrollTopDelta).toBeCloseTo(T7.y + T7.h / 2 - band / 2, 6);
  });

  it("leaves a box that already fits at the zoom it was found at", () => {
    // A caption row: 300×40 child pixels. Nothing about this needs pulling back,
    // and magnifying it would move the paper under someone who chose this zoom.
    const plan = revealPlan({ x: 100, y: 300, w: 300, h: 40 }, CANVAS, 1.1913);
    expect(plan.zoom).toBeCloseTo(1.1913, 6);
  });

  it("never magnifies, however small the box", () => {
    const plan = revealPlan({ x: 0, y: 0, w: 4, h: 4 }, CANVAS, 0.5);
    expect(plan.zoom).toBe(0.5);
  });

  it("keeps scrollLeft inside what the footprint can actually scroll", () => {
    // A page narrower than the canvas has nothing to scroll: a wanted scrollLeft
    // past the end would show grey beside the sheet.
    const wide = revealPlan(T7, { w: 2000, h: 852 }, 0.5);
    expect(wide.scrollLeft).toBe(0);
    // …and at a zoom where the footprint IS wider, it is capped at the overflow.
    const tight = revealPlan(
      { x: 700, y: 0, w: 60, h: 60 },
      { w: 400, h: 852 },
      2,
    );
    expect(tight.scrollLeft).toBeLessThanOrEqual(FRAME_BASE_W * 2 - 400);
    expect(tight.scrollLeft).toBeGreaterThan(0);
  });

  it("does nothing rather than something wrong on a canvas not yet measured", () => {
    const plan = revealPlan(T7, { w: 0, h: 0 }, 1.5);
    expect(plan).toEqual({ zoom: 1.5, scrollTopDelta: 0, scrollLeft: 0 });
  });

  it("ignores an axis whose room the padding has already eaten", () => {
    // A canvas shorter than two pads is not a canvas to fit a plate into, and
    // letting it drive the zoom would floor the specialist at 25%.
    const plan = revealPlan(T7, { w: 984, h: 40 }, 1.1913);
    expect(plan.zoom).toBeCloseTo((984 - 48) / T7.w, 6);
  });
});
