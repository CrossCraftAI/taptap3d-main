// What the overlay draws, and the gate in front of the database.
//
// Two kinds of test here, and the second is the one that could not be written
// anywhere else. The first is ordinary: rings, marks and the commit gate are
// pure functions over rectangles, and a ring drawn around the wrong box throws
// nothing. The second holds the ATTRIBUTE CONTRACT — the overlay reads
// `data-lot`, `data-field`, `data-frame-source` and `data-page-frame` out of
// the preview, the renderer writes them, and the two live in different files
// with no type between them. So this renders a real document and reads it with
// the overlay's own constants. Rename an attribute in either place and this
// fails here, rather than as an editor that silently selects nothing.

import { describe, expect, it } from "vitest";

import {
  ATTR,
  clipMarks,
  gestureFrame,
  handlesFor,
  HANDLE_HIT_PX,
  HANDLE_SIZE_PX,
  overlapMarks,
  OVERLAP_MIN_PX,
  pressMode,
  sameGuides,
  sameOverlaps,
  snapContext,
  clipOverflow,
  DRAG_THRESHOLD_PX,
  isDrag,
  PART_SELECTOR,
  PAGE_SELECTOR,
  parsePageFrame,
  placementFrame,
  PLACED_BY_HAND,
  PLACED_SELECTOR,
  ringsFor,
  sameClips,
  type MeasuredPart,
} from "@/lib/editor/overlay-model";
import {
  fromPageFrame,
  guidesFor,
  snapDelta,
  HANDLE_CURSOR,
  MIN_SIZE_PX,
  RESIZE_HANDLES,
} from "@/lib/editor/drag-geometry";
import {
  identityFrom,
  type OverlayRect,
  type PreviewSelection,
} from "@/lib/editor/selection-geometry";
import { derive, type EngineLot, type EngineOverride } from "@/lib/engine/derive";
import { renderCatalogue } from "@/lib/render/html";

const PAGE: OverlayRect = { x: 40, y: 60, w: 800, h: 1131 };
const sel = (lotId: string, field: string): PreviewSelection => ({ lotId, field });

function part(
  lotId: string,
  field: string,
  rect: OverlayRect,
  extra: Partial<MeasuredPart> = {},
): MeasuredPart {
  return { sel: sel(lotId, field), rect, page: PAGE, placed: false, ...extra };
}

// ── The attribute contract ───────────────────────────────────────────────────

describe("the attributes the overlay reads are the attributes the renderer writes", () => {
  const LOTS: EngineLot[] = [
    { id: "lot-a", ref: "P01", fields: { title: "無題" }, images: [] },
    { id: "lot-b", ref: "P02", fields: { title: "Second" }, images: [] },
  ];
  const FRAME = { x: 0.125, y: 0.25, w: 0.5, h: 0.375 };
  const PLACED: EngineOverride[] = [{ lotId: "lot-a", field: "title", frame: FRAME }];
  const html = renderCatalogue(derive(LOTS, undefined, [], PLACED));

  // The selectors are strings this module owns; a document is a string. So the
  // read is a regex over the attribute NAME the module declares, which is
  // exactly the coupling under test.
  const attr = (name: string): string[] =>
    [...html.matchAll(new RegExp(`${name}="([^"]*)"`, "g"))].map((m) => m[1]!);

  it("publishes a lot and a field on every part, and the pair is the override key", () => {
    expect(PART_SELECTOR).toBe(`[${ATTR.field}]`);
    expect(attr(ATTR.lot)).toContain("lot-a");
    expect(attr(ATTR.field)).toEqual(expect.arrayContaining(["title", "ref"]));
    // The pair IS a selection; neither half alone is.
    expect(identityFrom("lot-a", "title")).toEqual({ lotId: "lot-a", field: "title" });
    expect(identityFrom("lot-a", null)).toBeNull();
  });

  it("marks the hand-placed part, and only it", () => {
    expect(PLACED_SELECTOR).toBe(`[${ATTR.placedBy}="${PLACED_BY_HAND}"]`);
    expect(attr(ATTR.placedBy)).toEqual([PLACED_BY_HAND]);
    // Two lots, one placed part: the other lot's title is still in its caption.
    expect(html).toContain(`class="line line--title placed"`);
    expect(html).toContain(`class="line line--title"`);
  });

  it("publishes the stored frame, so an audit need not parse the style attribute", () => {
    const [published] = attr(ATTR.frame);
    expect(published).toBe("0.125000,0.250000,0.500000,0.375000");
    const parsed = published!.split(",").map(Number);
    expect(parsed).toEqual([FRAME.x, FRAME.y, FRAME.w, FRAME.h]);
  });

  it("puts the page where the overlay looks for it", () => {
    expect(PAGE_SELECTOR).toBe(".page");
    expect(html).toContain(`<section class="page page--grid"`);
  });

  it("leaves the entry unselectable, because there is no row to write for it", () => {
    // `<article class="slot" data-lot="…">` and no data-field: identityFrom
    // refuses the half-identity, which is what stops a drag on the gap between
    // two lines writing a row against a field key no renderer emits.
    expect(html).toContain(`<article class="slot" ${ATTR.lot}="lot-a">`);
  });

  it("does not publish a subject box yet, and the overlay must not invent one", () => {
    // parseContent's own note: every plate reads as the whole picture today.
    // Stated here so the day the renderer measures one, this test says so.
    expect(attr(ATTR.content)).toEqual([]);
  });

  it("reads its own published frame back, byte for byte", () => {
    // The loop that matters for undo: what the renderer wrote is what the
    // overlay recovers, with no rounding of its own in between.
    expect(parsePageFrame(attr(ATTR.frame)[0])).toEqual(FRAME);
  });
});

describe("parsePageFrame", () => {
  it("is null for a part the engine placed", () => {
    // Absence is the answer, not a zero frame: "nobody has moved this" is the
    // state undo has to be able to restore.
    expect(parsePageFrame(null)).toBeNull();
    expect(parsePageFrame(undefined)).toBeNull();
    expect(parsePageFrame("")).toBeNull();
  });

  it("refuses anything that is not four numbers", () => {
    // Taking the first four of a longer attribute would be a guess at somebody
    // else's data; a half-written frame is corrupt rather than smaller.
    expect(parsePageFrame("0.1,0.2,0.3")).toBeNull();
    expect(parsePageFrame("0.1,0.2,0.3,0.4,0.5")).toBeNull();
    expect(parsePageFrame("0.1,0.2,0.3,x")).toBeNull();
  });

  it("refuses a frame of no size, for the reason MIN_SIZE_PX exists", () => {
    // A part stored at nothing can never be selected again, so there would be
    // no way back to it.
    expect(parsePageFrame("0.1,0.2,0,0.4")).toBeNull();
    expect(parsePageFrame("0.1,0.2,0.3,-0.4")).toBeNull();
  });

  it("keeps a frame that has bled off the paper, which is a real placement", () => {
    expect(parsePageFrame("-0.25,0.2,0.5,0.4")).toEqual({
      x: -0.25,
      y: 0.2,
      w: 0.5,
      h: 0.4,
    });
  });
});

// ── Rings ────────────────────────────────────────────────────────────────────

describe("ringsFor", () => {
  const A = part("lot-a", "title", { x: 100, y: 100, w: 200, h: 40 });
  const B = part("lot-b", "title", { x: 100, y: 300, w: 200, h: 40 });

  it("rings nothing when nothing is selected or hovered", () => {
    expect(
      ringsFor({ parts: [A, B], selected: null, hovered: null, live: null }),
    ).toEqual([]);
  });

  it("paints the hover under the selection, and never both on one box", () => {
    const both = ringsFor({
      parts: [A, B],
      selected: A.sel,
      hovered: B.sel,
      live: null,
    });
    expect(both.map((r) => r.kind)).toEqual(["hover", "selected"]);
    // Hovering what is already selected is one ring, not two stacked.
    const same = ringsFor({
      parts: [A, B],
      selected: A.sel,
      hovered: A.sel,
      live: null,
    });
    expect(same.map((r) => r.kind)).toEqual(["selected"]);
  });

  it("follows the pointer with the ring, because the ink cannot move", () => {
    const live = { x: 520, y: 640, w: 200, h: 40 };
    const rings = ringsFor({ parts: [A], selected: A.sel, hovered: null, live });
    expect(rings).toHaveLength(1);
    expect(rings[0]!.rect).toEqual(live);
    // And the measured box is NOT also drawn: two rings would say the part is
    // in two places.
    expect(rings.some((r) => r.rect.x === A.rect.x)).toBe(false);
  });

  it("drops the hover while a drag runs", () => {
    const rings = ringsFor({
      parts: [A, B],
      selected: A.sel,
      hovered: B.sel,
      live: { x: 0, y: 0, w: 10, h: 10 },
    });
    expect(rings.map((r) => r.kind)).toEqual(["selected"]);
  });

  it("outlines the picture inside a plate whose frame is visibly bigger", () => {
    // A portrait photograph object-fit into a landscape box: the frame carries
    // obvious slack either side, and a ring on the frame alone reads as a bug
    // (ROADMAP M1's carried defect).
    const plate = part(
      "lot-a",
      "images",
      { x: 0, y: 0, w: 400, h: 200 },
      { picture: { x: 150, y: 0, w: 100, h: 200 } },
    );
    const rings = ringsFor({
      parts: [plate],
      selected: plate.sel,
      hovered: null,
      live: null,
    });
    expect(rings.map((r) => r.kind)).toEqual(["selected", "muted"]);
    expect(rings[1]!.rect).toEqual(plate.picture);
    // Distinct React keys, or one ring would paint for two boxes.
    expect(new Set(rings.map((r) => r.key)).size).toBe(2);
  });

  it("says nothing about the picture when it fills its frame", () => {
    const plate = part(
      "lot-a",
      "images",
      { x: 0, y: 0, w: 400, h: 200 },
      { picture: { x: 1, y: 1, w: 399, h: 199 } },
    );
    // Within boxesDiffer's few pixels: a second outline there would sit on the
    // first and read as a rendering artefact.
    expect(
      ringsFor({ parts: [plate], selected: plate.sel, hovered: null, live: null }),
    ).toHaveLength(1);
  });

  it("moves the accent to the picture in subject mode, and mutes the frame", () => {
    const plate = part(
      "lot-a",
      "images",
      { x: 0, y: 0, w: 400, h: 200 },
      { picture: { x: 150, y: 0, w: 100, h: 200 } },
    );
    const rings = ringsFor({
      parts: [plate],
      selected: plate.sel,
      hovered: null,
      live: null,
      subjectMode: true,
    });
    // One accent, always: the frame steps back rather than competing.
    expect(rings.map((r) => r.kind)).toEqual(["muted", "subject"]);
  });

  it("hides the picture outline while the frame is being dragged", () => {
    const plate = part(
      "lot-a",
      "images",
      { x: 0, y: 0, w: 400, h: 200 },
      { picture: { x: 150, y: 0, w: 100, h: 200 } },
    );
    const rings = ringsFor({
      parts: [plate],
      selected: plate.sel,
      hovered: null,
      live: { x: 300, y: 300, w: 400, h: 200 },
    });
    // The picture has not moved — the preview is not written to — so drawing it
    // at the old place beside a ring at the new one would be a lie.
    expect(rings.map((r) => r.kind)).toEqual(["selected"]);
  });

  it("rings nothing for a selection that is no longer on the page", () => {
    // A density change can take a lot to another page, or an import can remove
    // it. The selection survives; the box does not.
    expect(
      ringsFor({ parts: [A], selected: sel("lot-gone", "title"), hovered: null, live: null }),
    ).toEqual([]);
  });
});

// ── The clipping mark ────────────────────────────────────────────────────────

describe("clipOverflow", () => {
  it("ignores the sub-pixel difference a box that fits still reports", () => {
    expect(clipOverflow({ scrollW: 200.4, scrollH: 40.6, clientW: 200, clientH: 40 })).toEqual(
      { x: 0, y: 0 },
    );
  });

  it("reports how much ink is missing, per axis", () => {
    expect(clipOverflow({ scrollW: 200, scrollH: 96, clientW: 200, clientH: 40 })).toEqual({
      x: 0,
      y: 56,
    });
    expect(clipOverflow({ scrollW: 260, scrollH: 40, clientW: 200, clientH: 40 })).toEqual({
      x: 60,
      y: 0,
    });
  });
});

describe("clipMarks", () => {
  const fit = { scrollW: 200, scrollH: 96, clientW: 200, clientH: 40 };

  it("marks a placed part that is cutting its own text", () => {
    const placed = part("lot-a", "title", { x: 10, y: 20, w: 200, h: 40 }, { placed: true, fit });
    const marks = clipMarks([placed]);
    expect(marks).toHaveLength(1);
    expect(marks[0]!.rect).toEqual(placed.rect);
    expect(marks[0]!.overflowPx).toBe(56);
    expect(marks[0]!.axis).toBe("y");
  });

  it("leaves an in-flow caption alone, however tightly the engine budgeted it", () => {
    // The engine's caption budget is a deterministic property of the document
    // and belongs to the defect gate, not to a drag overlay — and a mark on
    // most rows of a 43-page flow is the same as no mark at all.
    const inFlow = part("lot-a", "title", { x: 10, y: 20, w: 200, h: 40 }, { fit });
    expect(clipMarks([inFlow])).toEqual([]);
  });

  it("says nothing about a placed part nobody measured", () => {
    const placed = part("lot-a", "title", { x: 10, y: 20, w: 200, h: 40 }, { placed: true });
    expect(clipMarks([placed])).toEqual([]);
  });

  it("names both axes when both are cut", () => {
    const placed = part(
      "lot-a",
      "title",
      { x: 10, y: 20, w: 200, h: 40 },
      { placed: true, fit: { scrollW: 260, scrollH: 96, clientW: 200, clientH: 40 } },
    );
    expect(clipMarks([placed])[0]!.axis).toBe("both");
    // The worse of the two, so the number names the cut a person will notice.
    expect(clipMarks([placed])[0]!.overflowPx).toBe(60);
  });

  // ── THE GESTURE THAT ACTUALLY MAKES THIS STATE ───────────────────────────
  //
  // The mark shipped with the DRAG, on the argument that a move freezes the
  // box's size as a fraction of the page while the type scale goes on moving —
  // a part nobody touches, starting to cut. True, and indirect. A RESIZE cuts
  // the text on purpose and immediately: the specialist pulls the `s` handle
  // up and the last line goes, with nothing on the screen or the paper to say
  // so, because `.placed` carries `overflow: hidden` and the caption's own
  // "there is more" fade is keyed to `.caption`, which a lifted part is not in
  // (src/lib/render/html.ts).
  //
  // Nothing in `clipMarks` had to change for it, and THAT is what is held
  // here: the mark is a function of the measured box against its own ink, so
  // it does not care which gesture made the box small. The case is written
  // down so a later change cannot narrow it to the drag without failing.
  it("marks a box a HANDLE shrank, and marks the box rather than the missing ink", () => {
    // 200 × 40 of ink in a box the `s` handle has pulled down to 22.
    const shrunk = part(
      "lot-a",
      "title",
      { x: 10, y: 20, w: 200, h: 22 },
      { placed: true, fit: { scrollW: 200, scrollH: 40, clientW: 200, clientH: 22 } },
    );
    const marks = clipMarks([shrunk]);
    expect(marks).toHaveLength(1);
    expect(marks[0]!.axis).toBe("y");
    expect(marks[0]!.overflowPx).toBe(18);
    // THE WHOLE BOX, which is the opposite of GrowthMark's choice and is the
    // same reasoning read the other way: a clipped box's overflow is nowhere —
    // it was never painted — and the box is what the specialist has to make
    // bigger again.
    expect(marks[0]!.rect).toEqual(shrunk.rect);
  });

  it("marks a box a handle shrank to the floor, where the cut is certain", () => {
    // `MIN_SIZE_PX` is where `dragRect` stops, and at 8px nothing this
    // renderer sets in `clamp(7px, …)` fits with its leading. A resize can
    // always reach this state, so the mark must always be able to report it.
    const floored = part(
      "lot-a",
      "title",
      { x: 10, y: 20, w: MIN_SIZE_PX, h: MIN_SIZE_PX },
      {
        placed: true,
        fit: { scrollW: 180, scrollH: 34, clientW: MIN_SIZE_PX, clientH: MIN_SIZE_PX },
      },
    );
    expect(clipMarks([floored])[0]!.axis).toBe("both");
  });
});

describe("sameClips", () => {
  const mark = { key: "k", rect: { x: 1, y: 2, w: 3, h: 4 }, overflowPx: 5, axis: "y" as const };

  it("is true for the same marks and false for any difference", () => {
    expect(sameClips([mark], [{ ...mark }])).toBe(true);
    expect(sameClips([mark], [])).toBe(false);
    expect(sameClips([mark], [{ ...mark, overflowPx: 6 }])).toBe(false);
    expect(sameClips([mark], [{ ...mark, rect: { x: 1, y: 2, w: 3, h: 5 } }])).toBe(false);
  });
});

// ── The gesture and the commit gate ──────────────────────────────────────────

describe("isDrag", () => {
  it("lets a click be a click", () => {
    // A hand pressing a button moves; without this every selection would write
    // a frame for a part nobody moved.
    expect(isDrag(0, 0)).toBe(false);
    expect(isDrag(2, -2)).toBe(false);
    expect(isDrag(DRAG_THRESHOLD_PX, 0)).toBe(true);
    expect(isDrag(0, -DRAG_THRESHOLD_PX)).toBe(true);
  });

  it("begins before anything can snap to anything", () => {
    // SNAP_PX is 6 in drag-geometry.ts; a gesture that could snap before it
    // had started would jump on its first frame.
    expect(DRAG_THRESHOLD_PX).toBeLessThan(6);
  });
});

describe("placementFrame", () => {
  const start: OverlayRect = { x: 140, y: 160, w: 400, h: 200 };

  it("converts a finished move into the fractions that get stored", () => {
    const frame = placementFrame(start, PAGE, 80, 40)!;
    expect(frame).not.toBeNull();
    // (140 + 80 - 40) / 800, (160 + 40 - 60) / 1131 …
    expect(frame.x).toBeCloseTo(180 / 800, 10);
    expect(frame.y).toBeCloseTo(140 / 1131, 10);
    expect(frame.w).toBeCloseTo(0.5, 10);
    expect(frame.h).toBeCloseTo(200 / 1131, 10);
  });

  it("round-trips back to the rectangle the pointer left behind", () => {
    // The conversion is the one place a silent error would be indistinguishable
    // from a correct edit, so it is checked in both directions.
    const frame = placementFrame(start, PAGE, -35, 17)!;
    const back = fromPageFrame(frame, PAGE);
    expect(back.x).toBeCloseTo(start.x - 35, 10);
    expect(back.y).toBeCloseTo(start.y + 17, 10);
    expect(back.w).toBeCloseTo(start.w, 10);
    expect(back.h).toBeCloseTo(start.h, 10);
  });

  it("keeps a part that bleeds past the trim, because that is a real design", () => {
    // A full-bleed plate leaves the paper on two sides by design, so this is
    // not a containment check — only a refusal of what has left it entirely.
    const frame = placementFrame(start, PAGE, -300, -200)!;
    expect(frame).not.toBeNull();
    expect(frame.x).toBeLessThan(0);
    expect(frame.y).toBeLessThan(0);
    expect(frame.x + frame.w).toBeGreaterThan(0);
  });

  it("refuses a part dragged off the paper altogether", () => {
    // An edit the human cannot see is an edit they cannot drag back.
    expect(placementFrame(start, PAGE, 5000, 0)).toBeNull();
    expect(placementFrame(start, PAGE, 0, -5000)).toBeNull();
  });

  it("refuses a page that has not laid out", () => {
    // A frame that has just navigated measures zero; saving Infinity — or the
    // zeros toPageFrame answers with instead — would store a frame nothing can
    // ever paint or clear.
    expect(placementFrame(start, { x: 0, y: 0, w: 0, h: 0 }, 10, 10)).toBeNull();
  });

  it("is `gestureFrame` in the move case, to the number", () => {
    // The two must not be two conversions. A resize that rounded differently
    // from a drag would move a part by a hair every time it was resized, and
    // nothing on screen or on paper would say which of the two did it.
    expect(placementFrame(start, PAGE, 61, -13)).toEqual(
      gestureFrame(start, PAGE, "move", 61, -13),
    );
  });
});

describe("gestureFrame — the resize commits through the same boundary", () => {
  const start: OverlayRect = { x: 140, y: 160, w: 400, h: 200 };

  it("moves the dragged edge and leaves the opposite one where it was", () => {
    // `se` grows width and height from the top-left; the stored x and y are
    // therefore unchanged, which is the property a resize must have and a
    // move must not.
    const frame = gestureFrame(start, PAGE, "se", 60, 30)!;
    expect(frame.x).toBeCloseTo(100 / 800, 10);
    expect(frame.y).toBeCloseTo(100 / 1131, 10);
    expect(frame.w).toBeCloseTo(460 / 800, 10);
    expect(frame.h).toBeCloseTo(230 / 1131, 10);
  });

  it("moves the origin when the north-west corner is the one being dragged", () => {
    const frame = gestureFrame(start, PAGE, "nw", 40, 20)!;
    expect(frame.x).toBeCloseTo(140 / 800, 10);
    expect(frame.y).toBeCloseTo(120 / 1131, 10);
    expect(frame.w).toBeCloseTo(360 / 800, 10);
    expect(frame.h).toBeCloseTo(180 / 1131, 10);
  });

  it("stops at the minimum size rather than turning the box inside out", () => {
    // Past the far edge an unclamped `w = start.w - dx` reappears on the other
    // side of the pointer. `MIN_SIZE_PX` exists because a part resized to
    // nothing can never be selected again — there is no handle left to grab
    // and no box left to click, so the reset it needs is unreachable.
    const frame = gestureFrame(start, PAGE, "e", -5000, 0)!;
    expect(frame.w).toBeCloseTo(MIN_SIZE_PX / 800, 10);
    expect(frame.w).toBeGreaterThan(0);
  });

  it("refuses a resize that has taken the box off the paper", () => {
    // The same gate as a drag: the browser must not post what the server would
    // refuse, and `committable` is the server's own predicate.
    expect(gestureFrame(start, PAGE, "e", -5000, 0)).not.toBeNull();
    expect(gestureFrame({ ...start, x: PAGE.x + PAGE.w + 50 }, PAGE, "se", 10, 10)).toBeNull();
  });
});

// ── The handles ──────────────────────────────────────────────────────────────

describe("handlesFor", () => {
  const BOX: OverlayRect = { x: 100, y: 200, w: 300, h: 150 };

  it("gives eight handles, each on its own point, each with a cursor", () => {
    const handles = handlesFor(BOX);
    expect(handles.map((h) => h.key)).toEqual([...RESIZE_HANDLES]);
    expect(handles.find((h) => h.key === "nw")!.at).toEqual({ x: 100, y: 200 });
    expect(handles.find((h) => h.key === "se")!.at).toEqual({ x: 400, y: 350 });
    for (const handle of handles) {
      expect(handle.cursor).toBe(HANDLE_CURSOR[handle.key]);
    }
  });

  it("paints nothing when there is nothing selected", () => {
    expect(handlesFor(null)).toEqual([]);
  });

  it("paints all eight on a box too small to hold them apart", () => {
    // A 1-up caption row is a handful of pixels tall, so its nw, w and sw
    // squares overlap — and they are painted anyway, because the alternative
    // is a selection offering no way to resize exactly the parts a specialist
    // resizes most. `hitHandle` tests corners first for the same reason.
    expect(handlesFor({ x: 0, y: 0, w: 300, h: 14 })).toHaveLength(8);
  });

  it("keeps the hit box wider than the square it paints", () => {
    // The relationship, not either number: the grip is 2 × HANDLE_HIT_PX
    // across against a HANDLE_SIZE_PX paint, so aiming at a corner does not
    // have to be precise. Bigger and the n/s hit boxes of a caption row would
    // swallow the whole box and a press in the middle could never mean "move".
    expect(2 * HANDLE_HIT_PX).toBeGreaterThan(HANDLE_SIZE_PX);
    expect(2 * HANDLE_HIT_PX).toBeLessThan(2 * HANDLE_SIZE_PX + MIN_SIZE_PX);
  });
});

describe("pressMode", () => {
  const BOX: OverlayRect = { x: 100, y: 200, w: 300, h: 150 };

  it("reads a press on a corner as that corner and not as a move", () => {
    // The ordering IS the gesture's meaning: a corner handle sits ON the box,
    // so `contains` is true there too, and asking it first would make every
    // corner a move and the handles unreachable.
    expect(pressMode(BOX, { x: 102, y: 202 })).toBe("nw");
    expect(pressMode(BOX, { x: 250, y: 275 })).toBe("move");
  });

  it("reads a press just OUTSIDE a corner as that corner", () => {
    // Half of every corner square hangs outside the box, and the whole of its
    // hit box does. Without this a press there lands on the lot underneath and
    // selects the neighbour instead of resizing what the hand is holding.
    expect(pressMode(BOX, { x: 95, y: 195 })).toBe("nw");
    expect(pressMode(BOX, { x: 405, y: 355 })).toBe("se");
  });

  it("answers null off the box and its grips, and null with no selection", () => {
    expect(pressMode(BOX, { x: 20, y: 20 })).toBeNull();
    expect(pressMode(null, { x: 102, y: 202 })).toBeNull();
  });
});

// ── What a gesture may align to ──────────────────────────────────────────────

describe("snapContext", () => {
  const A = sel("lot-a", "title");
  const SLOT: OverlayRect = { x: 80, y: 100, w: 300, h: 400 };
  const MINE: OverlayRect = { x: 100, y: 120, w: 200, h: 20 };
  const THEIRS: OverlayRect = { x: 400, y: 600, w: 200, h: 20 };

  it("leaves the moving part out of its own neighbours", () => {
    // Left in, every gesture would align to where the part already is at a
    // distance of zero — closer than any real target — so nothing would ever
    // snap and no guide would ever be drawn.
    const ctx = snapContext(A, PAGE, SLOT, [
      part("lot-a", "title", MINE),
      part("lot-b", "title", THEIRS),
    ]);
    expect(ctx.neighbours).toEqual([THEIRS]);
  });

  it("drops parts on another sheet", () => {
    // A part forty pages down the flow is at overlay coordinates this page
    // also uses; aligning to it would be aligning to a coincidence.
    const elsewhere = { ...PAGE, y: PAGE.y + PAGE.h + 24 };
    const ctx = snapContext(A, PAGE, SLOT, [
      part("lot-b", "title", THEIRS, { page: elsewhere }),
    ]);
    expect(ctx.neighbours).toEqual([]);
  });

  it("reads an absent slot as the page rather than as a box at the origin", () => {
    // A part somebody has already placed is emitted as a child of `.page` and
    // has no slot to find. A zero-sized box would put three phantom targets at
    // the overlay's origin, and a part dragged near the canvas's top-left
    // corner would snap to nothing visible.
    expect(snapContext(A, PAGE, null, []).slot).toEqual(PAGE);
  });

  it("produces a context the snap and the guides both act on", () => {
    // The pair is the point: `snapDelta` pulls the edge onto the neighbour and
    // `guidesFor` then finds the alignment in the FINAL rectangle, so the line
    // is drawn if and only if the snap actually landed.
    const neighbour: OverlayRect = { x: 300, y: 900, w: 150, h: 40 };
    const moving: OverlayRect = { x: 303, y: 500, w: 200, h: 20 };
    const ctx = snapContext(A, PAGE, SLOT, [part("lot-b", "title", neighbour)]);
    const delta = snapDelta(moving, "move", ctx);
    expect(delta.x).toBeCloseTo(-3, 10);
    const snapped = { ...moving, x: moving.x + delta.x };
    expect(guidesFor(snapped, "move", ctx).some((g) => g.axis === "x" && g.at === 300)).toBe(true);
  });
});

describe("sameGuides", () => {
  const one = { axis: "x" as const, at: 300, from: 100, to: 900 };
  it("is quiet when the paint would not change, and not when it would", () => {
    expect(sameGuides([one], [{ ...one }])).toBe(true);
    expect(sameGuides([one], [{ ...one, at: 301 }])).toBe(false);
    expect(sameGuides([one], [])).toBe(false);
    expect(sameGuides([], [])).toBe(true);
  });
});

// ── Overlap ──────────────────────────────────────────────────────────────────

describe("overlapMarks", () => {
  // THE FAILURE IT EXISTS FOR, written as the case: a part dragged out of its
  // own caption and left sitting on the lot below. Nothing is cut — the ink
  // underneath is painted and then covered — so `clipMarks` is silent, the
  // renderer is silent, and the page prints that way.
  const OVER: OverlayRect = { x: 100, y: 500, w: 200, h: 40 };
  const UNDER: OverlayRect = { x: 120, y: 520, w: 300, h: 60 };

  it("names the part underneath, and marks only where they meet", () => {
    const marks = overlapMarks([
      part("lot-a", "title", OVER, { placed: true }),
      part("lot-b", "ref", UNDER),
    ]);
    expect(marks).toHaveLength(1);
    // The intersection, not the placed box: 120..300 by 520..540.
    expect(marks[0]!.rect).toEqual({ x: 120, y: 520, w: 180, h: 20 });
    expect(marks[0]!.under).toEqual(sel("lot-b", "ref"));
  });

  it("says nothing about a part over its OWN caption", () => {
    // The commonest deliberate gesture in the product, and the reason a frame
    // is a fraction of the page rather than of the slot. Marking it would put
    // a warning on every composed entry in the sale.
    expect(
      overlapMarks([
        part("lot-a", "images", OVER, { placed: true }),
        part("lot-a", "title", UNDER),
      ]),
    ).toEqual([]);
  });

  it("says nothing about two parts neither of which was placed", () => {
    // The engine laid these out. If they overlap, that is the engine's doing
    // and belongs to the defect gate, not to a gesture nobody made.
    expect(overlapMarks([part("lot-a", "title", OVER), part("lot-b", "ref", UNDER)])).toEqual([]);
  });

  it("says nothing across two sheets at the same overlay coordinates", () => {
    // A long flow puts page two's parts at overlay coordinates that page one
    // also used. Without the page check every part would be marked against its
    // opposite number on every other sheet.
    const elsewhere = { ...PAGE, y: PAGE.y + PAGE.h + 24 };
    expect(
      overlapMarks([
        part("lot-a", "title", OVER, { placed: true }),
        part("lot-b", "ref", UNDER, { page: elsewhere }),
      ]),
    ).toEqual([]);
  });

  it("ignores a touch below the threshold on either axis", () => {
    // Flush against a neighbour, off by a rounding artefact of the
    // measurement. One pixel is not a composition anybody must answer for.
    const flush = { x: OVER.x + OVER.w - (OVERLAP_MIN_PX - 1), y: OVER.y, w: 100, h: 40 };
    expect(
      overlapMarks([part("lot-a", "title", OVER, { placed: true }), part("lot-b", "ref", flush)]),
    ).toEqual([]);
  });

  it("is quiet when the paint would not change", () => {
    const parts = [part("lot-a", "title", OVER, { placed: true }), part("lot-b", "ref", UNDER)];
    expect(sameOverlaps(overlapMarks(parts), overlapMarks(parts))).toBe(true);
    const moved = [parts[0]!, part("lot-b", "ref", { ...UNDER, y: UNDER.y + 4 })];
    expect(sameOverlaps(overlapMarks(parts), overlapMarks(moved))).toBe(false);
  });
});
