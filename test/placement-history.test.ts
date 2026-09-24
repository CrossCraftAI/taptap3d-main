// What a placement replaced, and how it is put back.
//
// The control is a later tranche and this is tested now because the RECORDING
// cannot be added later: the frame a drag overwrote exists only in the instant
// before the write. What is held here is the shape of that instant — including
// the one that reads as "there was nothing", which has a real inverse and a
// real patch, and which a nullable field is the only honest way to carry.

import { describe, expect, it } from "vitest";

import type { PageFrame } from "@/lib/editor/drag-geometry";
import { roundFrame } from "@/lib/engine/frame";
import {
  dropLast,
  entryFor,
  forget,
  HISTORY_LIMIT,
  last,
  record,
  redoPatch,
  sameFrame,
  stillApplies,
  undoPatch,
  type PlacementEntry,
} from "@/lib/editor/placement-history";
import { selectionKey, type PreviewSelection } from "@/lib/editor/selection-geometry";
import { frameFromValue, intersectsPage } from "@/lib/engine/frame";

const SEL: PreviewSelection = { lotId: "lot-a", field: "title" };
const WAS: PageFrame = { x: 0.1, y: 0.1, w: 0.4, h: 0.2 };
const NOW: PageFrame = { x: 0.3, y: 0.5, w: 0.4, h: 0.2 };

const entry = (before: PageFrame | null, after: PageFrame, at = 1): PlacementEntry =>
  entryFor(SEL, before, after, at)!;

describe("entryFor", () => {
  it("addresses the part exactly the way a ring does", () => {
    expect(entry(null, NOW).key).toBe(selectionKey(SEL));
    expect(entry(null, NOW)).toMatchObject({ lotId: "lot-a", field: "title" });
  });

  it("records the absence of a previous frame as a value, not as a gap", () => {
    // "The engine placed this" is a state with an inverse. An entry that
    // merely had no `before` could only be undone by guessing.
    expect(entry(null, NOW).before).toBeNull();
  });

  it("is nothing at all when the gesture put the part back where it was", () => {
    // A hand does this. Recording it would make the next undo appear to do
    // nothing, which a person reads as a broken button.
    expect(entryFor(SEL, WAS, { ...WAS }, 1)).toBeNull();
  });

  it("is an entry when any one number moved", () => {
    expect(entryFor(SEL, WAS, { ...WAS, h: WAS.h + 1e-6 }, 1)).not.toBeNull();
  });
});

describe("sameFrame", () => {
  it("treats two absences as the same and an absence as unlike any frame", () => {
    expect(sameFrame(null, null)).toBe(true);
    expect(sameFrame(null, WAS)).toBe(false);
    expect(sameFrame(WAS, null)).toBe(false);
  });
});

describe("record", () => {
  it("keeps placements in the order they were made", () => {
    const history = record(record([], entry(null, NOW, 1)), entry(NOW, WAS, 2));
    expect(history.map((e) => e.at)).toEqual([1, 2]);
    expect(last(history)!.at).toBe(2);
  });

  it("does not merge a run of placements into one", () => {
    // Three drags that walk a plate across a page are three decisions, not one
    // long one. Merging them would be the tool overruling the specialist, and
    // it would be a second count of the same work disagreeing with the log.
    let history: PlacementEntry[] = [];
    for (let i = 0; i < 3; i++) {
      history = record(history, entry(null, { ...NOW, x: 0.1 * i }, i));
    }
    expect(history).toHaveLength(3);
  });

  it("drops the OLDEST past the limit, because the newest is what undo needs", () => {
    let history: PlacementEntry[] = [];
    for (let i = 0; i < HISTORY_LIMIT + 5; i++) {
      history = record(history, entry(null, { ...NOW, x: i / 1000 }, i));
    }
    expect(history).toHaveLength(HISTORY_LIMIT);
    expect(history[0]!.at).toBe(5);
    expect(last(history)!.at).toBe(HISTORY_LIMIT + 4);
  });

  it("leaves the history it was given alone", () => {
    const before: PlacementEntry[] = [entry(null, NOW, 1)];
    record(before, entry(NOW, WAS, 2));
    expect(before).toHaveLength(1);
  });

  it("says there is nothing to undo on an untouched session", () => {
    expect(last([])).toBeNull();
  });
});

describe("undoPatch", () => {
  it("sends only the frame, so a typo fix on the same field survives", () => {
    // This is the second writer OverridePatch was introduced for. A patch that
    // named anything else would undo work the drag never did.
    const patch = undoPatch(entry(WAS, NOW));
    expect(Object.keys(patch)).toEqual(["frame"]);
    expect(patch.frame).toEqual(WAS);
  });

  it("clears the frame, rather than the row, when the engine had placed it", () => {
    // An explicit null is distinguishable from an absent key: null clears that
    // one key and the part goes back to being derived; absent would leave it
    // exactly where the drag put it.
    const patch = undoPatch(entry(null, NOW));
    expect(patch.frame).toBeNull();
    expect("frame" in patch).toBe(true);
  });

  it("restores something the engine and the database will both accept", () => {
    const patch = undoPatch(entry(WAS, NOW));
    expect(intersectsPage(patch.frame!)).toBe(true);
    expect(frameFromValue(patch.frame)).toEqual(WAS);
  });
});

describe("redoPatch", () => {
  it("is the inverse of the inverse, and undo of redo is the original", () => {
    const e = entry(WAS, NOW);
    expect(redoPatch(e).frame).toEqual(NOW);
    expect(undoPatch(e).frame).toEqual(WAS);
  });
});

// ── The half of undo that stops it lying ─────────────────────────────────────

describe("stillApplies", () => {
  it("accepts an entry the document still agrees with", () => {
    // The ordinary case: nobody has touched the part since it was placed, so
    // `data-page-frame` reads back exactly what the entry wrote.
    expect(stillApplies(entry(WAS, NOW), { ...NOW })).toBe(true);
  });

  it("refuses an entry whose part has been moved since", () => {
    // A second tab, a colleague, or the same person in the lot form. Undoing
    // here would put the part back to a position that was replaced an hour
    // ago, with nothing on screen to say a correction nobody made had landed.
    expect(stillApplies(entry(WAS, NOW), { ...NOW, x: NOW.x + 0.01 })).toBe(false);
  });

  it("refuses an entry whose part has been handed back to the engine", () => {
    // `Reset placement`, or the row cleared from the lot page: the renderer
    // publishes no `data-page-frame` at all, which parses to null.
    expect(stillApplies(entry(WAS, NOW), null)).toBe(false);
  });

  it("compares the STORED numbers, not a re-measured box", () => {
    // The whole reason `parsePageFrame` reads the attribute rather than the
    // painted rectangle. A box measured off the page and converted back
    // differs from the stored value by the renderer's rounding on its way to a
    // CSS percentage — four decimals, against six stored — so a check built on
    // a measurement would clear the stack on every second undo.
    const rounded = { ...NOW, x: Math.round(NOW.x * 1e4) / 1e4 + 1e-6 };
    expect(stillApplies(entry(WAS, NOW), rounded)).toBe(false);
  });
});

describe("dropLast", () => {
  it("takes the newest entry off and leaves the rest in order", () => {
    const one = entry(null, WAS, 1);
    const two = entry(WAS, NOW, 2);
    const stack = record(record([], one), two);
    expect(dropLast(stack)).toEqual([one]);
    expect(last(dropLast(stack))).toEqual(one);
  });

  it("is safe on an empty stack", () => {
    // Reached by an undo whose verification cleared the history a moment
    // earlier, which is the path that matters: the two happen on one press.
    expect(dropLast([])).toEqual([]);
  });

  it("does not mutate the stack it was handed", () => {
    // The canvas holds the history in a ref and re-reads it on the next
    // measurement pass; a mutating pop would change what a render in flight
    // had already been told.
    const stack = [entry(null, WAS, 1), entry(WAS, NOW, 2)];
    dropLast(stack);
    expect(stack).toHaveLength(2);
  });
});

describe("forget", () => {
  const OTHER: PreviewSelection = { lotId: "lot-b", field: "images" };
  const otherEntry = entryFor(OTHER, null, NOW, 3)!;

  it("takes out one part's entries and leaves every other lot's alone", () => {
    // What `Reset placement` owes the stack. `stillApplies` would catch the
    // staleness and then clear EVERYTHING, because a verification failure
    // means "somebody changed this behind me". Here we are the somebody, and
    // we know exactly which entries we invalidated.
    const stack = [entry(null, WAS, 1), otherEntry, entry(WAS, NOW, 2)];
    expect(forget(stack, selectionKey(SEL))).toEqual([otherEntry]);
  });

  it("is keyed the way a ring is", () => {
    // `selectionKey`'s JSON, so "the same part" means what it means everywhere
    // else in this layer — and in particular is injective, which a naive
    // `${lotId}-${field}` join is not.
    const stack = [entry(null, WAS, 1)];
    expect(forget(stack, selectionKey(OTHER))).toEqual(stack);
    expect(forget(stack, selectionKey(SEL))).toEqual([]);
  });

  it("does not mutate the stack it was handed", () => {
    const stack = [entry(null, WAS, 1), otherEntry];
    forget(stack, selectionKey(SEL));
    expect(stack).toHaveLength(2);
  });
});

describe("an entry is recorded at the resolution the page publishes", () => {
  // THE DEFECT THIS CLOSES, and it made undo unusable rather than wrong at the
  // margin. `after` arrives from the pointer at full precision; the document
  // publishes the STORED frame, which `overrideFromValue` has rounded. With an
  // exact comparison in `stillApplies`, the two never matched — so every undo
  // took the "this part has changed since it was placed" branch, cleared the
  // stack, and left the placement exactly where it was.
  const sel = { lotId: "lot-a", field: "title" };
  const raw = { x: 0.1234567891, y: 0.5, w: 0.4320071234, h: 0.0189889999 };

  it("matches the frame the renderer prints, not the one the pointer computed", () => {
    const entry = entryFor(sel, null, raw, 1)!;
    expect(entry).not.toBeNull();
    // What the page will carry: the same frame through the same rounding.
    const published = roundFrame(raw);
    expect(stillApplies(entry, published)).toBe(true);
    // And the raw number is NOT what was kept — that is the whole point.
    expect(entry.after).toEqual(published);
  });

  it("still refuses when the part really did move", () => {
    const entry = entryFor(sel, null, raw, 1)!;
    const moved = { ...roundFrame(raw), y: 0.6 };
    expect(stillApplies(entry, moved)).toBe(false);
  });

  it("calls a gesture that rounds to where it started no gesture at all", () => {
    // Under the rounding, a move of less than the renderer's own resolution is
    // not a move — recording it would put an entry on the stack whose undo a
    // person could not see happen.
    const before = roundFrame(raw);
    const nudged = { ...before, x: before.x + 1e-9 };
    expect(entryFor(sel, before, nudged, 1)).toBeNull();
  });
});
