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
  overlapMarks,
  OVERLAP_MIN_PX,
  sameOverlaps,
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
import { fromPageFrame } from "@/lib/editor/drag-geometry";
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
