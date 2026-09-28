// Picking a run of rows with the pointer.
//
// Extracted from src/components/photograph-library.tsx when the sale's index
// needed the same gesture. These are the cases that made extracting it worth
// more than copying it: every one of them is a detail a reimplementation would
// have to get right by accident, and none is visible until somebody selects
// forty rows and gets thirty-nine.

import { describe, expect, it } from "vitest";

import { NOTHING, click, cleared, onScreen } from "@/lib/selection";

const ROWS = ["a", "b", "c", "d", "e", "f"];
const picked = (s: { ids: ReadonlySet<string> }): string[] => [...s.ids].sort();

describe("one click at a time", () => {
  it("adds, then removes the same row", () => {
    const one = click(NOTHING, ROWS, 2, false);
    expect(picked(one)).toEqual(["c"]);
    expect(one.anchor).toBe(2);
    expect(picked(click(one, ROWS, 2, false))).toEqual([]);
  });

  it("keeps the anchor on the last row touched", () => {
    const two = click(click(NOTHING, ROWS, 1, false), ROWS, 4, false);
    expect(picked(two)).toEqual(["b", "e"]);
    expect(two.anchor).toBe(4);
  });
});

describe("shift extends the run", () => {
  it("from the anchor to the row clicked, in either direction", () => {
    const down = click(click(NOTHING, ROWS, 1, false), ROWS, 4, true);
    expect(picked(down)).toEqual(["b", "c", "d", "e"]);

    const up = click(click(NOTHING, ROWS, 4, false), ROWS, 1, true);
    expect(picked(up)).toEqual(["b", "c", "d", "e"]);
  });

  it("moves the anchor, so a run can be walked down in steps", () => {
    // The behaviour that differs between implementations, and the one that
    // lets a person extend twice without going back to the start.
    const first = click(click(NOTHING, ROWS, 0, false), ROWS, 2, true);
    expect(first.anchor).toBe(2);
    const second = click(first, ROWS, 4, true);
    expect(picked(second)).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("only ever adds, even over rows already picked", () => {
    // Extending a selection and inverting one are different intentions, and a
    // gesture that silently did the second would undo a careful run.
    const run = click(click(NOTHING, ROWS, 0, false), ROWS, 3, true);
    const again = click(run, ROWS, 1, true);
    expect(picked(again)).toEqual(["a", "b", "c", "d"]);
  });

  it("is an ordinary click when there is no anchor to extend from", () => {
    expect(picked(click(NOTHING, ROWS, 3, true))).toEqual(["d"]);
  });

  it("is an ordinary click when the anchor is no longer on screen", () => {
    // A filter changed under the selection. Extending from a row that is not
    // drawn any more would pick a range nobody pointed at.
    const stale = { ids: new Set(["a"]), anchor: 99 };
    expect(picked(click(stale, ROWS, 2, true))).toEqual(["a", "c"]);
  });
});

describe("what a bulk action is allowed to act on", () => {
  it("is the intersection with what is drawn, in the drawn order", () => {
    // A selection can outlive its rows — a page turns, a filter narrows. The
    // count on the button and the rows that change have to be the same rows.
    const state = { ids: new Set(["e", "a", "zz"]), anchor: 0 };
    expect(onScreen(state, ROWS)).toEqual(["a", "e"]);
  });

  it("is empty after a clear, and so is the anchor", () => {
    expect(onScreen(cleared(), ROWS)).toEqual([]);
    expect(cleared().anchor).toBeNull();
  });
});

describe("a click outside the rows changes nothing", () => {
  it("rather than picking undefined", () => {
    const state = click(NOTHING, ROWS, 1, false);
    expect(click(state, ROWS, 99, false)).toBe(state);
  });
});
