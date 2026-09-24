// Condition: the derivations, the geometry, and the printed report.
//
// It is a CONDITION REPORT. Not "conditional".
//
// Three things are held here and none of them needs a database:
//
//   THE NUMBERING, which is derived and never stored, so a mark deleted in the
//   middle renumbers rather than leaving a hole — and the screen and the paper
//   have to agree about it or a bidder reads "mark 3" about a different chip.
//
//   THE LIFETIME GROUPING, which is the whole return on storing fractions of a
//   stable space instead of pixels of a file: "is this the chip we saw in
//   August" becomes arithmetic.
//
//   THE PIN GEOMETRY, wired from src/lib/editor/selection-geometry.ts. Three of
//   those four functions had no caller and no test before this screen, so each
//   is exercised HERE IN THE ROLE THIS SCREEN USES IT IN — a test of `pinPoint`
//   in the abstract would not have caught a viewer that passed it the frame
//   instead of the mark.
//
// The WRITERS are in test/custody.db.test.ts, against a real Postgres.

import { describe, expect, it } from "vitest";

import {
  MARK_RADIUS,
  MARK_SAME_WITHIN,
  VIEW_ASPECT,
  containedPicture,
  pinsFor,
  samePins,
  tapToFraction,
  tappableRegion,
  within,
  type OverlayRect,
  type ViewerMark,
} from "@/lib/condition-geometry";
import {
  clampFraction,
  conditionReportLot,
  isReferenceView,
  lifetimeOf,
  marksInView,
  numberedMarks,
  REFERENCE_VIEWS,
  type Examination,
  type Mark,
} from "@/lib/data/examinations";
import { derive, DEFAULT_PARAMS } from "@/lib/engine/derive";
import {
  BUILT_IN_TEMPLATES,
  CONDITION_REPORT,
  REPORT_TEMPLATES,
} from "@/lib/engine/templates";
import { renderCatalogue } from "@/lib/render/html";

const at = (iso: string): Date => new Date(iso);

let sequence = 0;
function mark(input: Partial<Mark> & { view: Mark["view"]; x: number; y: number }): Mark {
  sequence += 1;
  return {
    id: `m${sequence}`,
    note: "",
    at: at("2026-09-19T01:40:00Z"),
    ...input,
  };
}

function examination(input: Partial<Examination> & { id: string; at: Date }): Examination {
  return {
    movementId: null,
    examiner: null,
    light: null,
    summary: null,
    marks: [],
    views: {},
    ...input,
  };
}

// ── The numbering ───────────────────────────────────────────────────────────

describe("a mark's number is its place in the order its view was marked up", () => {
  const marks = [
    mark({ view: "front", x: 0.5, y: 0.02 }),
    mark({ view: "base", x: 0.24, y: 0.72 }),
    mark({ view: "front", x: 0.22, y: 0.3 }),
    mark({ view: "reverse", x: 0.58, y: 0.44 }),
    mark({ view: "front", x: 0.64, y: 0.94 }),
  ];

  it("restarts per view, because the views are separate spaces", () => {
    // A footrim mark cannot be expressed in the front view's coordinates at
    // all, so "mark 2" said while the front is showing has to mean the second
    // mark on the front.
    expect(marksInView(marks, "front").map((m) => m.number)).toEqual([1, 2, 3]);
    expect(marksInView(marks, "base").map((m) => m.number)).toEqual([1]);
    expect(marksInView(marks, "reverse").map((m) => m.number)).toEqual([1]);
  });

  it("walks the views in a fixed order, so the printed report is stable", () => {
    expect(numberedMarks(marks).map((m) => `${m.view} ${m.number}`)).toEqual([
      "front 1",
      "front 2",
      "front 3",
      "reverse 1",
      "base 1",
    ]);
  });

  it("renumbers when one is removed, which is why it is not a column", () => {
    // A stored `position` would leave a hole here and make deleting mark 2 a
    // renumbering job. Principle 1: keys are never positional.
    const without = marks.filter((m) => m !== marks[0]);
    expect(marksInView(without, "front").map((m) => m.number)).toEqual([1, 2]);
    expect(marksInView(without, "front")[0]!.id).toBe(marks[2]!.id);
  });

  it("knows which views it can draw, and refuses anything else", () => {
    expect(REFERENCE_VIEWS).toEqual(["front", "reverse", "base"]);
    expect(isReferenceView("front")).toBe(true);
    expect(isReferenceView("recto")).toBe(false);
    expect(isReferenceView(null)).toBe(false);
  });
});

// ── The lifetime view ───────────────────────────────────────────────────────

describe("the lifetime view is a lookup, because the coordinates are stable", () => {
  const august = examination({
    id: "aug",
    at: at("2026-08-28T06:20:00Z"),
    examiner: "L. Cheung",
    marks: [
      mark({ view: "front", x: 0.5, y: 0.02, note: "Two shallow glaze nicks to the rim." }),
      mark({ view: "front", x: 0.22, y: 0.3, note: "An 8 mm firing flaw." }),
      mark({ view: "base", x: 0.24, y: 0.72, note: "Kiln grit on the footrim." }),
    ],
  });
  // The same object a fortnight later: the rim and the flaw are found again a
  // hair off where they were recorded, and one new scuff has appeared.
  const september = examination({
    id: "sep",
    at: at("2026-09-19T01:40:00Z"),
    examiner: "L. Cheung",
    marks: [
      mark({ view: "front", x: 0.508, y: 0.024, note: "Unchanged." }),
      mark({ view: "front", x: 0.218, y: 0.302, note: "Unchanged." }),
      mark({ view: "front", x: 0.38, y: 0.6, note: "A 4 mm scuff, not present on receipt." }),
    ],
  });
  const history = [august, september];

  it("rolls the same fault into one entry with its sightings in date order", () => {
    const faults = lifetimeOf(history);
    const rim = faults.find((f) => f.view === "front" && f.number === 1)!;
    expect(rim.sightings.map((s) => s.note)).toEqual([
      "Two shallow glaze nicks to the rim.",
      "Unchanged.",
    ]);
    expect(rim.sightings.map((s) => s.first)).toEqual([true, false]);
  });

  it("fixes the position at the FIRST sighting, so nothing drifts", () => {
    // Three sightings a percent apart would otherwise chain, and the entry's
    // position would become the newest one — moving a numbered fault under a
    // reader who has already printed the report.
    const rim = lifetimeOf(history).find((f) => f.number === 1 && f.view === "front")!;
    expect(rim.x).toBe(0.5);
    expect(rim.y).toBe(0.02);
  });

  it("gives a genuinely new fault its own entry, numbered after the old ones", () => {
    const front = lifetimeOf(history).filter((f) => f.view === "front");
    expect(front.map((f) => f.number)).toEqual([1, 2, 3]);
    const scuff = front[2]!;
    expect(scuff.sightings).toHaveLength(1);
    expect(scuff.sightings[0]!.first).toBe(true);
    expect(scuff.sightings[0]!.at).toEqual(september.at);
  });

  it("never merges across views, whatever the coordinates say", () => {
    // Front (0.24, 0.72) and base (0.24, 0.72) are the same two numbers and
    // two different places on the object.
    const collide = [
      examination({ id: "a", at: at("2026-01-01T00:00:00Z"), marks: [mark({ view: "front", x: 0.24, y: 0.72 })] }),
      examination({ id: "b", at: at("2026-02-01T00:00:00Z"), marks: [mark({ view: "base", x: 0.24, y: 0.72 })] }),
    ];
    expect(lifetimeOf(collide)).toHaveLength(2);
  });

  it("separates two faults that are further apart than the tolerance", () => {
    const apart = MARK_SAME_WITHIN * 2;
    const pair = [
      examination({ id: "a", at: at("2026-01-01T00:00:00Z"), marks: [mark({ view: "front", x: 0.5, y: 0.5 })] }),
      examination({ id: "b", at: at("2026-02-01T00:00:00Z"), marks: [mark({ view: "front", x: 0.5 + apart, y: 0.5 })] }),
    ];
    expect(lifetimeOf(pair)).toHaveLength(1 + 1);
    // And joins them when the tolerance is widened past the gap, which is what
    // makes the number above a parameter rather than a coincidence.
    expect(lifetimeOf(pair, apart + 0.001)).toHaveLength(1);
  });

  it("is empty for a lot nobody has examined, rather than throwing", () => {
    expect(lifetimeOf([])).toEqual([]);
  });
});

describe("the tolerance is measured against the ring, not chosen", () => {
  it("is under one ring radius, so two marks that overlap cannot be two faults", () => {
    // The two numbers live in one file precisely so this can be asserted;
    // before that they were a comment in a client component pointing at a
    // comment in a module that opens a database.
    expect(MARK_SAME_WITHIN).toBeLessThan(MARK_RADIUS);
    expect(MARK_SAME_WITHIN).toBeGreaterThan(0);
  });
});

// ── The viewer's geometry, and the editor functions it wires ────────────────

describe("the reference view is the coordinate space", () => {
  /** A 420×665 box, which is what the viewer draws at its widest. */
  const FRAME: OverlayRect = { x: 0, y: 0, w: 420, h: 420 / VIEW_ASPECT };

  it("is taller than it is wide, because the objects are", () => {
    expect(VIEW_ASPECT).toBeLessThan(1);
    expect(FRAME.h).toBeGreaterThan(FRAME.w);
  });

  describe("containedPicture: where object-fit puts the photograph", () => {
    it("letterboxes a wide photograph top and bottom", () => {
      const picture = containedPicture(FRAME, { w: 4096, h: 3072 })!;
      expect(picture.w).toBeCloseTo(FRAME.w, 6);
      expect(picture.h).toBeCloseTo((FRAME.w * 3072) / 4096, 6);
      expect(picture.y).toBeGreaterThan(0);
      // Centred: the slack is the same above and below.
      expect(picture.y).toBeCloseTo(FRAME.h - (picture.y + picture.h), 6);
    });

    it("pillarboxes a narrow photograph left and right", () => {
      const picture = containedPicture(FRAME, { w: 1000, h: 4000 })!;
      expect(picture.h).toBeCloseTo(FRAME.h, 6);
      expect(picture.x).toBeGreaterThan(0);
    });

    it("is null before the image has loaded, which is not the same as zero", () => {
      expect(containedPicture(FRAME, null)).toBeNull();
      expect(containedPicture(FRAME, { w: 0, h: 0 })).toBeNull();
    });
  });

  describe("pinAnchor decides where a tap counts", () => {
    it("is the whole frame when no photograph stands for the view", () => {
      // The honest answer: there is nothing to be outside of, and a view with
      // no photograph is still a space a registrar can mark up.
      expect(tappableRegion(FRAME, null)).toEqual(FRAME);
    });

    it("is the painted picture when one does", () => {
      const region = tappableRegion(FRAME, { w: 4096, h: 3072 });
      expect(region.h).toBeLessThan(FRAME.h);
      expect(region.w).toBeCloseTo(FRAME.w, 6);
    });

    it("refuses a tap in the grey beside the picture", () => {
      const wide = { w: 4096, h: 3072 };
      const region = tappableRegion(FRAME, wide);
      // Ten pixels above the top edge of the picture is inside the box and
      // outside the object. A fault recorded there would sit in the air beside
      // the object for every reader afterwards.
      expect(within(region, { x: FRAME.w / 2, y: region.y - 10 })).toBe(false);
      expect(tapToFraction(FRAME, wide, { x: FRAME.w / 2, y: region.y - 10 })).toBeNull();
      // And accepts one a hair inside it.
      expect(tapToFraction(FRAME, wide, { x: FRAME.w / 2, y: region.y + 1 })).not.toBeNull();
    });

    it("stores fractions of the VIEW even when the picture is smaller", () => {
      // THE DEFECT THIS EXISTS FOR. Fractions of the picture would move every
      // mark the day a photograph is replaced with one of a different shape.
      const wide = { w: 4096, h: 3072 };
      const centre = tapToFraction(FRAME, wide, { x: FRAME.w / 2, y: FRAME.h / 2 })!;
      expect(centre.x).toBeCloseTo(0.5, 6);
      expect(centre.y).toBeCloseTo(0.5, 6);
      // The same point in a frame twice the size is the same fraction, which
      // is the resolution-independence the whole scheme is for.
      const bigger: OverlayRect = { x: 0, y: 0, w: 840, h: 840 / VIEW_ASPECT };
      const same = tapToFraction(bigger, wide, { x: bigger.w / 2, y: bigger.h / 2 })!;
      expect(same).toEqual(centre);
    });

    it("refuses a frame with no size rather than dividing by zero", () => {
      expect(tapToFraction({ x: 0, y: 0, w: 0, h: 0 }, null, { x: 0, y: 0 })).toBeNull();
    });
  });

  describe("pinPoint puts the number beside the mark, not on it", () => {
    const marks: ViewerMark[] = [
      { id: "a", number: 1, x: 0.5, y: 0.5, sightings: 1 },
      { id: "b", number: 2, x: 0.2, y: 0.8, sightings: 3 },
    ];

    it("hangs each badge off its own ring, up and to the right", () => {
      const [first] = pinsFor(marks, FRAME);
      const centre = { x: 0.5 * FRAME.w, y: 0.5 * FRAME.h };
      expect(first!.at.x).toBeGreaterThan(centre.x);
      expect(first!.at.y).toBeLessThan(centre.y);
      // Clear of the ring itself — the numeral must not sit on the chip.
      expect(first!.at.x - centre.x).toBeGreaterThan(MARK_RADIUS * FRAME.w);
    });

    it("keeps the marks' own order, because the caller numbers them by index", () => {
      expect(pinsFor(marks, FRAME).map((pin) => pin.key)).toEqual(["a", "b"]);
    });

    it("carries how many examinations saw the fault", () => {
      expect(pinsFor(marks, FRAME).map((pin) => pin.count)).toEqual([1, 3]);
    });
  });

  describe("samePins keeps a resize from re-rendering the same nothing", () => {
    const marks: ViewerMark[] = [{ id: "a", number: 1, x: 0.5, y: 0.5, sightings: 1 }];

    it("is true for two measurements of an unchanged view", () => {
      expect(samePins(pinsFor(marks, FRAME), pinsFor(marks, FRAME))).toBe(true);
    });

    it("is false the moment the box changes size", () => {
      const bigger: OverlayRect = { x: 0, y: 0, w: 421, h: 421 / VIEW_ASPECT };
      expect(samePins(pinsFor(marks, FRAME), pinsFor(marks, bigger))).toBe(false);
    });

    it("is false when a fault gains a sighting, which is a repaint worth doing", () => {
      const seen = [{ ...marks[0]!, sightings: 2 }];
      expect(samePins(pinsFor(marks, FRAME), pinsFor(seen, FRAME))).toBe(false);
    });
  });
});

describe("a fraction is bounded rather than refused", () => {
  it("clamps a hand that landed a pixel outside the box", () => {
    expect(clampFraction(-0.01)).toBe(0);
    expect(clampFraction(1.4)).toBe(1);
    expect(clampFraction(0.37)).toBe(0.37);
  });

  it("refuses a value that is not a number at all, which is a caller bug", () => {
    expect(clampFraction("0.5")).toBeNull();
    expect(clampFraction(Number.NaN)).toBeNull();
    expect(clampFraction(undefined)).toBeNull();
  });
});

// ── The printed report ──────────────────────────────────────────────────────

describe("the report prints through the one renderer", () => {
  const EXAMINATION = examination({
    id: "sep",
    at: at("2026-09-19T01:40:00Z"),
    examiner: "L. Cheung, Registrar",
    light: "Daylight · raking · UV",
    summary: "Overall in good condition for its age. No restoration under UV.",
    marks: [
      mark({ view: "front", x: 0.5, y: 0.02, note: "Two shallow glaze nicks to the rim." }),
      mark({ view: "front", x: 0.22, y: 0.3, note: "An 8 mm firing flaw, original to manufacture." }),
      mark({ view: "base", x: 0.24, y: 0.72, note: "Kiln grit on the unglazed footrim." }),
    ],
    views: { front: "plate-front" },
  });

  const LOT = {
    id: "lot-1",
    ref: "P01",
    fields: { title: "青花纏枝蓮紋梅瓶", maker: "佚名", price: "800,000 – 1,200,000 HKD" },
  };

  const record = conditionReportLot({
    lot: LOT,
    examination: EXAMINATION,
    occasion: "Warehouse, Kwai Chung → Saleroom, 19 Sept 2026",
    provenance: "Lin family collection, Taipei, until 2026",
  });

  const document = derive(
    [record],
    { ...DEFAULT_PARAMS, template: CONDITION_REPORT.id, perPage: 1 },
    [],
    [],
    REPORT_TEMPLATES,
  );

  it("is a sheet: one lot, one page", () => {
    expect(document.template.id).toBe("condition-report");
    expect(document.template.arrangement).toBe("sheet");
    expect(document.pages).toHaveLength(1);
    expect(document.pages[0]!.slots).toHaveLength(1);
  });

  it("names the view beside the number, because paper has no switcher", () => {
    // On screen the switcher says which view is showing. "front 2" and
    // "base 2" would otherwise both print as "2".
    const keys = document.pages[0]!.slots[0]!.caption.map((line) => line.key);
    expect(keys).toEqual([
      "title",
      "maker",
      "Examined",
      "Examiner",
      "Light",
      "Occasion",
      "Summary",
      "Mark front 1",
      "Mark front 2",
      "Mark base 1",
      "Provenance",
    ]);
  });

  it("prints every mark's prose whole, with no taxonomy anywhere near it", () => {
    const html = renderCatalogue(document);
    expect(html).toContain("Two shallow glaze nicks to the rim.");
    expect(html).toContain("An 8 mm firing flaw, original to manufacture.");
    expect(html).toContain("Kiln grit on the unglazed footrim.");
  });

  it("prints the reference view as the plate", () => {
    expect(document.pages[0]!.slots[0]!.image).toBe("plate-front");
    expect(document.unphotographed).toBe(0);
  });

  it("says something for a mark somebody placed and never described", () => {
    // A blank line under a number reads as a report that found nothing, which
    // is the one thing this document must not be mistaken for.
    const silent = conditionReportLot({
      lot: LOT,
      examination: examination({
        id: "x",
        at: at("2026-09-19T01:40:00Z"),
        marks: [mark({ view: "front", x: 0.4, y: 0.4 })],
      }),
    });
    expect(silent.fields["Mark front 1"]).toBe("Noted, no description.");
  });

  it("carries the public chain, which is the print path reading the new table", () => {
    expect(renderCatalogue(document)).toContain("Lin family collection, Taipei, until 2026");
  });

  it("prints the lifetime report as a history per fault", () => {
    const rolled = conditionReportLot({
      lot: LOT,
      examination: EXAMINATION,
      lifetime: lifetimeOf([
        examination({
          id: "aug",
          at: at("2026-08-28T06:20:00Z"),
          marks: [mark({ view: "front", x: 0.5, y: 0.02, note: "First noted. 2 mm." })],
        }),
        examination({
          id: "sep",
          at: at("2026-09-19T01:40:00Z"),
          marks: [mark({ view: "front", x: 0.502, y: 0.021, note: "Unchanged." })],
        }),
      ]),
    });
    expect(rolled.fields["Mark front 1"]).toBe(
      "2026-08-28 — First noted. 2 mm.\n2026-09-19 — Unchanged.",
    );
  });

  it("does not drop a mark on a page that is full of them", () => {
    // A report that shortened itself to fit would be a report that hides a
    // fault, which is the one failure this document cannot have. Forty marks
    // is past the default budget of every catalogue template.
    const many = examination({
      id: "many",
      at: at("2026-09-19T01:40:00Z"),
      marks: Array.from({ length: 40 }, (_, i) =>
        mark({ view: "front", x: 0.1 + i / 100, y: 0.5, note: `Fault ${i + 1}.` }),
      ),
    });
    const full = derive(
      [conditionReportLot({ lot: LOT, examination: many })],
      { ...DEFAULT_PARAMS, template: CONDITION_REPORT.id, perPage: 1 },
      [],
      [],
      REPORT_TEMPLATES,
    );
    const printed = full.pages[0]!.slots[0]!.caption.filter((line) =>
      line.key.startsWith("Mark "),
    );
    expect(printed).toHaveLength(40);
    // And whole: nothing was clipped with an ellipsis.
    expect(printed.every((line) => !line.value.endsWith("…"))).toBe(true);
  });

  it("is not offered as a catalogue layout, because a sale is not a stack of reports", () => {
    // `BUILT_IN_TEMPLATES` is what the editor's template control lists. A sale
    // laid out on this would print a page per lot of fields no lot record has.
    expect(BUILT_IN_TEMPLATES.map((t) => t.id)).not.toContain("condition-report");
    expect(REPORT_TEMPLATES.map((t) => t.id)).toEqual(["condition-report"]);
  });
});
