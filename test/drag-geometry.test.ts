// The gesture arithmetic (session 3, E2). Tested rather than looked at, because
// a drag that is wrong throws nothing, fails no structural check and shows up
// only as a client's artwork in the wrong place on a printed page.

import { describe, expect, it } from "vitest";

import {
  boxesDiffer,
  committable,
  contains,
  dragRect,
  fromPageFrame,
  guidesFor,
  handlePoint,
  HANDLE_CURSOR,
  hitHandle,
  MIN_SIZE_PX,
  nudgeDelta,
  NUDGE_COARSE_PX,
  NUDGE_PX,
  parseContent,
  RESIZE_HANDLES,
  snapDelta,
  subjectRect,
  toPageFrame,
  type SnapContext,
} from "@/lib/editor/drag-geometry";
import type { OverlayRect } from "@/lib/editor/selection-geometry";

const BOX: OverlayRect = { x: 100, y: 200, w: 300, h: 150 };

describe("dragRect", () => {
  it("translates on move and changes no size", () => {
    expect(dragRect(BOX, "move", 25, -40)).toEqual({
      x: 125,
      y: 160,
      w: 300,
      h: 150,
    });
  });

  it("moves only the dragged edge on a single-axis resize", () => {
    expect(dragRect(BOX, "e", 50, 999)).toEqual({ x: 100, y: 200, w: 350, h: 150 });
    expect(dragRect(BOX, "s", 999, 50)).toEqual({ x: 100, y: 200, w: 300, h: 200 });
    // A west drag moves the ORIGIN as well as the width — the classic place to
    // get a resize wrong, and the reason this is a function and not four lines
    // inlined in a pointermove handler.
    expect(dragRect(BOX, "w", 40, 0)).toEqual({ x: 140, y: 200, w: 260, h: 150 });
    expect(dragRect(BOX, "n", 0, 40)).toEqual({ x: 100, y: 240, w: 300, h: 110 });
  });

  it("moves both edges of a corner", () => {
    expect(dragRect(BOX, "se", 10, 20)).toEqual({ x: 100, y: 200, w: 310, h: 170 });
    expect(dragRect(BOX, "nw", 10, 20)).toEqual({ x: 110, y: 220, w: 290, h: 130 });
  });

  it("never turns a box inside out", () => {
    // Dragging the west handle far past the east edge is an ordinary slip, and
    // an unclamped `w = w - dx` answers it with a negative width — which the
    // schema rejects on save, so the specialist's gesture would end in a red
    // error sentence instead of a small box.
    const r = dragRect(BOX, "w", 5000, 0);
    expect(r.w).toBe(MIN_SIZE_PX);
    expect(r.x).toBe(BOX.x + BOX.w - MIN_SIZE_PX);
    const b = dragRect(BOX, "n", 0, 5000);
    expect(b.h).toBe(MIN_SIZE_PX);
    expect(b.y).toBe(BOX.y + BOX.h - MIN_SIZE_PX);
    const c = dragRect(BOX, "se", -5000, -5000);
    expect(c.w).toBe(MIN_SIZE_PX);
    expect(c.h).toBe(MIN_SIZE_PX);
  });

  it("is a pure function of the START rect, so it can be re-run", () => {
    // Snapping folds its correction into the delta and calls this again; if the
    // function were incremental that second call would double the move.
    const once = dragRect(BOX, "move", 30, 30);
    const twice = dragRect(BOX, "move", 30, 30);
    expect(once).toEqual(twice);
  });
});

describe("handles", () => {
  it("puts eight handles on the frame's own corners and edge midpoints", () => {
    expect(RESIZE_HANDLES).toHaveLength(8);
    expect(handlePoint(BOX, "nw")).toEqual({ x: 100, y: 200 });
    expect(handlePoint(BOX, "se")).toEqual({ x: 400, y: 350 });
    expect(handlePoint(BOX, "n")).toEqual({ x: 250, y: 200 });
    expect(handlePoint(BOX, "w")).toEqual({ x: 100, y: 275 });
  });

  it("hit-tests within the radius and misses outside it", () => {
    expect(hitHandle(BOX, { x: 104, y: 203 }, 6)).toBe("nw");
    expect(hitHandle(BOX, { x: 250, y: 350 }, 6)).toBe("s");
    expect(hitHandle(BOX, { x: 250, y: 275 }, 6)).toBeNull();
  });

  it("prefers the corner where a corner and an edge overlap", () => {
    // With a wide hit radius on a small box the `n` band reaches the corner. A
    // human aiming at the corner of a picture means the corner.
    const small: OverlayRect = { x: 0, y: 0, w: 20, h: 20 };
    expect(hitHandle(small, { x: 1, y: 1 }, 8)).toBe("nw");
  });

  it("contains() answers for the move gesture", () => {
    expect(contains(BOX, { x: 101, y: 201 })).toBe(true);
    expect(contains(BOX, { x: 99, y: 201 })).toBe(false);
  });

  // WIRED AT LAST, and only now worth a test. The cursor reaches the screen on
  // the capture layer the canvas mounts for the life of a gesture
  // (src/components/preview-canvas.tsx): an overlay that takes no pointer has
  // no hover cursor to give, so that layer is the map's one consumer and this
  // pairing is its one guarantee.
  it("names a cursor for every handle, and pairs the opposite corners", () => {
    for (const handle of RESIZE_HANDLES) {
      expect(HANDLE_CURSOR[handle]).toMatch(/-resize$/);
    }
    // A handle's identity IS which edges it moves, so which diagonal it sits
    // on is a property of the compass point rather than a lookup somebody
    // chose. One of these backwards puts a ↗ cursor on a ↘ corner, which reads
    // as the box being about to go the other way.
    expect(HANDLE_CURSOR.nw).toBe(HANDLE_CURSOR.se);
    expect(HANDLE_CURSOR.ne).toBe(HANDLE_CURSOR.sw);
    expect(HANDLE_CURSOR.n).toBe(HANDLE_CURSOR.s);
    expect(HANDLE_CURSOR.e).toBe(HANDLE_CURSOR.w);
    // And the two diagonals are not the same cursor — the failure the pairing
    // above cannot catch on its own.
    expect(HANDLE_CURSOR.nw).not.toBe(HANDLE_CURSOR.ne);
    expect(HANDLE_CURSOR.n).not.toBe(HANDLE_CURSOR.e);
  });
});

// ── Snapping ─────────────────────────────────────────────────────────────────

const PAGE: OverlayRect = { x: 0, y: 0, w: 1000, h: 1400 };
const SLOT: OverlayRect = { x: 100, y: 100, w: 400, h: 300 };

function ctx(neighbours: OverlayRect[] = []): SnapContext {
  return { page: PAGE, slot: SLOT, neighbours, threshold: 6 };
}

describe("snapDelta", () => {
  it("pulls a near-miss left edge onto a neighbour's left edge", () => {
    const neighbour: OverlayRect = { x: 300, y: 800, w: 200, h: 100 };
    const moving: OverlayRect = { x: 303, y: 500, w: 150, h: 60 };
    expect(snapDelta(moving, "move", ctx([neighbour])).x).toBe(-3);
  });

  it("snaps centres, not only edges", () => {
    const neighbour: OverlayRect = { x: 300, y: 800, w: 200, h: 100 }; // centre 400
    const moving: OverlayRect = { x: 322, y: 500, w: 150, h: 60 }; // centre 397
    expect(snapDelta(moving, "move", ctx([neighbour])).x).toBe(3);
  });

  it("snaps to the page edges and the page centre", () => {
    expect(snapDelta({ x: 4, y: 500, w: 100, h: 50 }, "move", ctx()).x).toBe(-4);
    // Page centre is 500; a box whose own centre is 497 is 3 away.
    expect(
      snapDelta({ x: 422, y: 900, w: 150, h: 50 }, "move", ctx()).x,
    ).toBe(3);
  });

  it("snaps to the slot, which is the engine's suggestion and not a law", () => {
    expect(snapDelta({ x: 103, y: 600, w: 50, h: 50 }, "move", ctx()).x).toBe(-3);
  });

  it("does nothing beyond the threshold", () => {
    // Chosen so that no edge OR centre of the box comes within 6 of any edge or
    // centre of the neighbour, the slot or the page — the first draft of this
    // fixture missed by putting the box's centre 5px from the neighbour's, which
    // is a snap the test then read as a bug in the code.
    const neighbour: OverlayRect = { x: 300, y: 800, w: 200, h: 100 };
    const moving: OverlayRect = { x: 320, y: 500, w: 130, h: 60 };
    expect(snapDelta(moving, "move", ctx([neighbour]))).toEqual({ x: 0, y: 0 });
  });

  it("prefers a neighbour to the page when both are equally close", () => {
    // Ordering, not arithmetic: an alignment with a visible object is one the
    // specialist can see; an alignment with an invisible page centre is not.
    //
    // The box's left edge is 3 from the neighbour's left (494) and 3 from the
    // page centre AND the slot's right edge (both 500). The neighbour is pushed
    // first and the search is strictly-closer, so it must win — the page answer
    // would have been +3, the opposite direction.
    const neighbour: OverlayRect = { x: 494, y: 1100, w: 20, h: 20 };
    const tie: OverlayRect = { x: 497, y: 1000, w: 20, h: 20 };
    expect(snapDelta(tie, "move", ctx([neighbour])).x).toBe(-3);
  });

  it("only offers the edges a RESIZE is actually dragging", () => {
    // The defect this prevents: an `e` resize whose LEFT edge happens to sit 2px
    // from a neighbour would grow or shrink the box to satisfy an alignment the
    // gesture cannot honestly make.
    const moving: OverlayRect = { x: 120, y: 500, w: 190, h: 60 }; // right = 310
    const nearLeft: OverlayRect = { x: 98, y: 800, w: 40, h: 40 }; // centre 118
    expect(snapDelta(moving, "e", ctx([nearLeft])).x).toBe(0);
    const nearRight: OverlayRect = { x: 200, y: 800, w: 113, h: 40 }; // right 313
    expect(snapDelta(moving, "e", ctx([nearRight])).x).toBe(3);
  });

  it("snaps both axes independently", () => {
    const neighbour: OverlayRect = { x: 300, y: 700, w: 200, h: 100 };
    const moving: OverlayRect = { x: 303, y: 704, w: 150, h: 60 };
    expect(snapDelta(moving, "move", ctx([neighbour]))).toEqual({ x: -3, y: -4 });
  });
});

describe("guidesFor", () => {
  it("draws nothing when nothing is aligned", () => {
    expect(guidesFor({ x: 333, y: 555, w: 77, h: 44 }, "move", ctx())).toEqual([]);
  });

  it("draws a line only when the edge genuinely coincides", () => {
    // Computed from the FINAL rect rather than remembered from snapDelta, so a
    // snap that the minimum-size clamp overrode shows no line rather than a line
    // the box is not on.
    const neighbour: OverlayRect = { x: 300, y: 800, w: 200, h: 100 };
    const snapped: OverlayRect = { x: 300, y: 500, w: 150, h: 60 };
    const guides = guidesFor(snapped, "move", ctx([neighbour]));
    const x = guides.find((g) => g.axis === "x");
    expect(x?.at).toBe(300);
  });

  it("draws ONE line per distinct alignment, not one per axis", () => {
    // The defect a photograph caught. A plate whose LEFT edge met the caption
    // and whose CENTRE met the page centre produced a single line standing on
    // the first coordinate while stretched to the reach of the second. Two real
    // alignments are two lines.
    //
    // moving spans x 100..1000 → left 100, centre 550, right 1000.
    // The neighbour's left is 100; the page centre (PAGE is 1000 wide) is 500…
    // so use a box whose centre lands on it exactly.
    const neighbour: OverlayRect = { x: 100, y: 1300, w: 40, h: 40 };
    const moving: OverlayRect = { x: 100, y: 600, w: 800, h: 50 }; // centre 500
    const guides = guidesFor(moving, "move", ctx([neighbour]));
    const xs = guides.filter((g) => g.axis === "x").map((g) => g.at).sort((a, b) => a - b);
    expect(xs).toEqual([100, 500]);
    // …and each keeps its OWN reach.
    const atNeighbour = guides.find((g) => g.axis === "x" && g.at === 100)!;
    const atPage = guides.find((g) => g.axis === "x" && g.at === 500)!;
    expect(atNeighbour.to).toBe(1340);
    expect(atPage.to).toBe(PAGE.h);
  });

  it("reaches from the moving box to everything it aligns with", () => {
    // One line, not three: quiet chrome is a requirement, and a single line that
    // touches all four boxes says "these agree" better than three stubs.
    // x = 310, deliberately off the slot's centre (300): the first draft used
    // 300 and the guide then correctly reached up to the slot as well, which is
    // right behaviour and a confusing test.
    const a: OverlayRect = { x: 310, y: 900, w: 100, h: 50 };
    const b: OverlayRect = { x: 310, y: 1200, w: 100, h: 50 };
    const moving: OverlayRect = { x: 310, y: 200, w: 100, h: 50 };
    const guides = guidesFor(moving, "move", ctx([a, b]));
    const x = guides.find((g) => g.axis === "x");
    expect(x).toBeDefined();
    expect(x!.at).toBe(310);
    expect(x!.from).toBe(200);
    expect(x!.to).toBe(1250);
  });
});

// ── The boundary ─────────────────────────────────────────────────────────────

describe("toPageFrame / fromPageFrame", () => {
  const page: OverlayRect = { x: 40, y: 90, w: 600, h: 848 };

  it("expresses a box as fractions of its page", () => {
    const f = toPageFrame({ x: 340, y: 514, w: 300, h: 424 }, page);
    expect(f.x).toBeCloseTo(0.5, 10);
    expect(f.y).toBeCloseTo(0.5, 10);
    expect(f.w).toBeCloseTo(0.5, 10);
    expect(f.h).toBeCloseTo(0.5, 10);
  });

  it("round-trips", () => {
    const rect: OverlayRect = { x: 123.4, y: 456.7, w: 89, h: 210 };
    const back = fromPageFrame(toPageFrame(rect, page), page);
    expect(back.x).toBeCloseTo(rect.x, 8);
    expect(back.y).toBeCloseTo(rect.y, 8);
    expect(back.w).toBeCloseTo(rect.w, 8);
    expect(back.h).toBeCloseTo(rect.h, 8);
  });

  it("adds NO scroll term — the page rect already carries it", () => {
    // The negative case selection-geometry.ts pins for toOverlayRect, restated
    // where the error would be PERSISTED rather than merely painted. Scrolling
    // the preview moves the element and its page by the same amount, so the
    // fraction is unchanged; a scroll offset added here would send a saved frame
    // off the top of the page by a screenful.
    const scrolled = { ...page, y: page.y - 500 };
    const before = toPageFrame({ x: 340, y: 514, w: 300, h: 424 }, page);
    const after = toPageFrame({ x: 340, y: 14, w: 300, h: 424 }, scrolled);
    expect(after).toEqual(before);
  });

  it("does not divide by a page box that has not been laid out", () => {
    const f = toPageFrame({ x: 1, y: 2, w: 3, h: 4 }, { x: 0, y: 0, w: 0, h: 0 });
    expect(Object.values(f).every(Number.isFinite)).toBe(true);
    expect(committable(f)).toBe(false);
  });
});

describe("committable", () => {
  it("accepts a bleed off the trim", () => {
    expect(committable({ x: -0.2, y: 0.1, w: 0.5, h: 0.3 })).toBe(true);
  });
  it("refuses a frame the human could never see again", () => {
    expect(committable({ x: 1.4, y: 0.1, w: 0.2, h: 0.2 })).toBe(false);
    expect(committable({ x: 0.1, y: 0.1, w: 0, h: 0.2 })).toBe(false);
    expect(committable({ x: NaN, y: 0.1, w: 0.2, h: 0.2 })).toBe(false);
  });
});

describe("nudgeDelta", () => {
  it("moves one pixel, or ten with shift", () => {
    expect(nudgeDelta("ArrowRight", false)).toEqual({ x: NUDGE_PX, y: 0 });
    expect(nudgeDelta("ArrowUp", true)).toEqual({ x: 0, y: -NUDGE_COARSE_PX });
  });
  it("ignores every other key", () => {
    expect(nudgeDelta("a", false)).toBeNull();
    expect(nudgeDelta("Enter", false)).toBeNull();
    expect(nudgeDelta("Escape", false)).toBeNull();
  });
});

// ── The picture inside the frame ─────────────────────────────────────────────

describe("parseContent", () => {
  it("reads the renderer's four fractions", () => {
    expect(parseContent("0.1000,0.2000,0.5000,0.6000")).toEqual({
      x: 0.1,
      y: 0.2,
      w: 0.5,
      h: 0.6,
    });
  });
  it("falls back to the whole picture rather than inventing a subject", () => {
    // An unmeasured plate has no attribute at all, which is the majority case
    // until the geometry backfill finishes. Drawing an outline around a guessed
    // box would be worse than drawing none.
    expect(parseContent(null)).toEqual({ x: 0, y: 0, w: 1, h: 1 });
    expect(parseContent("")).toEqual({ x: 0, y: 0, w: 1, h: 1 });
    expect(parseContent("1,2,3")).toEqual({ x: 0, y: 0, w: 1, h: 1 });
    expect(parseContent("a,b,c,d")).toEqual({ x: 0, y: 0, w: 1, h: 1 });
    expect(parseContent("0,0,0,1")).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });
});

describe("subjectRect", () => {
  it("locates the artwork inside an <img> that is bigger than its frame", () => {
    // The renderer offsets the <img> so the SUBJECT meets the frame edges, so
    // the element box is the FILE and the artwork is a sub-rectangle of it.
    const img: OverlayRect = { x: 100, y: 100, w: 400, h: 200 };
    expect(subjectRect(img, { x: 0.25, y: 0.5, w: 0.5, h: 0.25 })).toEqual({
      x: 200,
      y: 200,
      w: 200,
      h: 50,
    });
  });
  it("is the identity for an unmeasured picture", () => {
    const img: OverlayRect = { x: 10, y: 20, w: 30, h: 40 };
    expect(subjectRect(img, { x: 0, y: 0, w: 1, h: 1 })).toEqual(img);
  });
});

describe("boxesDiffer", () => {
  it("ignores a sub-millimetre gap", () => {
    // Below this the second outline sits on top of the ring and reads as a
    // rendering artefact rather than as information.
    const a: OverlayRect = { x: 0, y: 0, w: 100, h: 100 };
    expect(boxesDiffer(a, { x: 1, y: 1, w: 99, h: 99 })).toBe(false);
  });
  it("catches the fit-bottom plate's slack", () => {
    // The case in .data/live/sel-demo-plate.png: the frame's top edge is far
    // above the artwork's, which is what made a correct ring read as a bug.
    const frame: OverlayRect = { x: 0, y: 0, w: 300, h: 300 };
    const picture: OverlayRect = { x: 0, y: 90, w: 300, h: 210 };
    expect(boxesDiffer(frame, picture)).toBe(true);
  });
});

// ── WHAT A TURNED BOX SNAPS TO (UAT 18C) ─────────────────────────────────────
//
// A turned box's EDGES are not the screen's axes, so 「align its left edge with
// that caption's left edge」 is not a sentence about anything on the page. Its
// CENTRE is exactly as real as it ever was — it is the pivot, it does not move
// when the angle changes, and centring a turned stamp on a plate is the
// commonest thing anybody does with one.
//
// So: a MOVE offers the centre and nothing else; a RESIZE offers nothing. The
// TARGETS are untouched, because a turned box's centre meeting a neighbour's
// edge is a real, visible alignment.
//
// Two alternatives are refused here rather than in a comment alone. SNAPPING THE
// BOUNDING BOX would put one CORNER of the object on the line and every edge
// somewhere else, and `guidesFor` would then draw a rule the object touches at a
// single point while claiming an alignment along its whole length — the same lie
// the grouping fix in drag-geometry.ts had to correct once already. DISABLING
// SNAP ENTIRELY costs the one alignment that still means something, on exactly
// the object you cannot place by eye.
function turnedCtx(neighbours: OverlayRect[] = [], deg = 30): SnapContext {
  return { ...ctx(neighbours), rotationDeg: deg };
}

describe("a turned box snaps its CENTRE and nothing else", () => {
  it("still snaps the centre to a neighbour's centre", () => {
    const neighbour: OverlayRect = { x: 300, y: 800, w: 200, h: 100 }; // centre 400
    const moving: OverlayRect = { x: 322, y: 500, w: 150, h: 60 }; // centre 397
    expect(snapDelta(moving, "move", turnedCtx([neighbour])).x).toBe(3);
  });

  it("no longer snaps an EDGE, which upright it would have", () => {
    // The identical case as the very first snapDelta test above: a left edge 3px
    // from a neighbour's left edge. Upright it snaps; turned it must not, and
    // the assertion is written against the upright answer so the two cannot
    // drift apart.
    const neighbour: OverlayRect = { x: 300, y: 800, w: 200, h: 100 };
    const moving: OverlayRect = { x: 303, y: 500, w: 150, h: 60 };
    expect(snapDelta(moving, "move", ctx([neighbour])).x).toBe(-3);
    expect(snapDelta(moving, "move", turnedCtx([neighbour])).x).toBe(0);
  });

  it("offers nothing at all on a RESIZE", () => {
    // A resize offers only the edges it drags, and on a turned box those edges
    // are the ones that have stopped meaning anything. There is no centre to
    // offer either: a resize moves the centre as a side effect, so snapping it
    // would change the SIZE to satisfy an alignment nobody asked for.
    const moving: OverlayRect = { x: 303, y: 500, w: 150, h: 60 };
    const neighbour: OverlayRect = { x: 300, y: 800, w: 200, h: 100 };
    expect(snapDelta(moving, "w", ctx([neighbour])).x).toBe(-3);
    expect(snapDelta(moving, "w", turnedCtx([neighbour])).x).toBe(0);
  });

  it("is UNCHANGED by a rotation of zero, absent or null", () => {
    // Absence must mean upright everywhere, or an object turned back to square
    // would keep the narrowed snapping for ever.
    const neighbour: OverlayRect = { x: 300, y: 800, w: 200, h: 100 };
    const moving: OverlayRect = { x: 303, y: 500, w: 150, h: 60 };
    for (const deg of [0, null, undefined]) {
      expect(
        snapDelta(moving, "move", { ...ctx([neighbour]), rotationDeg: deg }).x,
      ).toBe(-3);
    }
  });

  it("draws a guide for the centre and none for the edges", () => {
    // guidesFor reads the same movingValues, so the line and the snap cannot
    // disagree — a guide the box is not actually on is the one thing this layer
    // must never paint.
    const neighbour: OverlayRect = { x: 300, y: 800, w: 200, h: 100 }; // centre 400
    const landed: OverlayRect = { x: 325, y: 500, w: 150, h: 60 }; // centre 400
    const guides = guidesFor(landed, "move", turnedCtx([neighbour]));
    expect(guides.filter((g) => g.axis === "x").map((g) => g.at)).toEqual([400]);
  });

  it("reaches along the TURNED extent, not the frame's", () => {
    // The guide always touches the thing being dragged, so it is visibly about
    // this gesture — and for a turned box the thing being dragged is the quad.
    // Its bounds are the right EXTENT here, and emphatically the wrong thing to
    // snap to: a reach is chrome and a position is a claim.
    const neighbour: OverlayRect = { x: 300, y: 800, w: 200, h: 100 };
    const landed: OverlayRect = { x: 325, y: 500, w: 150, h: 60 };
    const turned = guidesFor(landed, "move", turnedCtx([neighbour], 90));
    // At 90° a 150 × 60 box occupies 60 × 150, so it reaches 45px further up
    // than its frame does: from 455 rather than from 500.
    expect(turned.find((g) => g.axis === "x")?.from).toBeCloseTo(455, 6);
  });
});

describe("a handle never swallows the box it belongs to", () => {
  // THE REGRESSION THIS CLOSES. A caption row is about sixteen pixels tall, so
  // with a flat eight-pixel reach the north and south handles each reached its
  // CENTRE — every press was a resize and the row could not be moved at all.
  // The drag is the gesture the editor exists for and it failed silently: the
  // ring stayed where it was and the gesture looked ignored.
  const caption = { x: 100, y: 200, w: 253, h: 16 };
  const plate = { x: 100, y: 200, w: 260, h: 220 };

  it("leaves the middle of a short row to the move", () => {
    const middle = { x: caption.x + caption.w / 2, y: caption.y + caption.h / 2 };
    expect(hitHandle(caption, middle, 8)).toBeNull();
    expect(contains(caption, middle)).toBe(true);
  });

  it("still gives that row its corners", () => {
    expect(hitHandle(caption, { x: caption.x, y: caption.y }, 8)).toBe("nw");
    expect(hitHandle(caption, { x: caption.x + caption.w, y: caption.y + caption.h }, 8)).toBe("se");
  });

  it("does not shrink the reach on a box big enough for it", () => {
    // A third of 220 is far more than eight, so the cap is inert here and the
    // caller's radius is what applies — a plate behaves exactly as before.
    expect(hitHandle(plate, { x: plate.x + 8, y: plate.y + 8 }, 8)).toBe("nw");
    expect(hitHandle(plate, { x: plate.x + 9, y: plate.y + 9 }, 8)).toBeNull();
  });

  it("gives an overlapping press to the handle it is nearest", () => {
    // On a short box `e` and `se` both reach a press near the bottom-right.
    // First-in-order handed it to `e`; a hand aiming there meant the corner.
    const nearCorner = { x: caption.x + caption.w, y: caption.y + caption.h - 1 };
    expect(hitHandle(caption, nearCorner, 8)).toBe("se");
  });
});
