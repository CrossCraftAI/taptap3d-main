// What a placement replaced, and how it is put back.
//
// The control is a later tranche and this is tested now because the RECORDING
// cannot be added later: the frame a drag overwrote exists only in the instant
// before the write. What is held here is the shape of that instant — including
// the one that reads as "there was nothing", which has a real inverse and a
// real patch, and which a nullable field is the only honest way to carry.

import { describe, expect, it } from "vitest";

import type { PageFrame } from "@/lib/editor/drag-geometry";
import {
  entryFor,
  HISTORY_LIMIT,
  last,
  record,
  redoPatch,
  sameFrame,
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
