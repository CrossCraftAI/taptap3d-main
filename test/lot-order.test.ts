// The running order, and the pin it must never break.
//
// ── THE PROPERTY THAT MATTERS MORE THAN ANY SINGLE CASE ────────────────────
//
// A pinned run must still be consecutive after ANY move. That is not one
// assertion — it is a property over every pair of (lot, destination), and the
// last test in this file checks it exhaustively over a small sale, because
// the failure it guards is silent: nothing throws, nothing is marked, the pin
// simply stops working and the specialist finds out at the printer.

import { describe, expect, it } from "vitest";

import {
  blockIndexOf,
  blocksOf,
  moveBefore,
  nudge,
  type OrderPin,
} from "@/lib/lot-order";

const SALE = ["a", "b", "c", "d", "e", "f"];
/** b and c are held together, as `createPin` would only ever allow. */
const PINS: OrderPin[] = [{ keepsTogether: true, lotIds: ["b", "c"] }];

/** Every lot still present, each exactly once. */
const isPermutation = (order: readonly string[], of: readonly string[]): boolean =>
  order.length === of.length && [...order].sort().join() === [...of].sort().join();

/** Are the pin's members consecutive, in any position? */
function together(order: readonly string[], members: readonly string[]): boolean {
  const at = members.map((m) => order.indexOf(m)).sort((x, y) => x - y);
  if (at[0] === -1) return false;
  return at.every((n, i) => i === 0 || n === at[i - 1]! + 1);
}

describe("the sale is a row of blocks, not a row of lots", () => {
  it("makes a pinned run one block and every other lot its own", () => {
    const blocks = blocksOf(SALE, PINS);
    expect(blocks.map((b) => b.lotIds)).toEqual([["a"], ["b", "c"], ["d"], ["e"], ["f"]]);
    expect(blocks.map((b) => b.pinned)).toEqual([false, true, false, false, false]);
  });

  it("and a sale with no pins is one block per lot", () => {
    expect(blocksOf(SALE, []).map((b) => b.lotIds)).toEqual([
      ["a"], ["b"], ["c"], ["d"], ["e"], ["f"],
    ]);
  });

  /**
   * MIRRORS THE ENGINE RATHER THAN HEALING THE DATA. `derive` merges a lot
   * into the current run only when the lot immediately before it carries the
   * same pin, so a pin whose members are already apart is two runs there. If
   * this function pulled them back together, it would show somebody a layout
   * the printer will not produce.
   */
  it("treats an already-split pin as two blocks, exactly as the engine does", () => {
    const split = ["b", "x", "c"];
    expect(blocksOf(split, PINS).map((b) => b.lotIds)).toEqual([["b"], ["x"], ["c"]]);
  });

  it("does not bracket a pin of one, because nothing is being held", () => {
    const lonely: OrderPin[] = [{ keepsTogether: true, lotIds: ["b"] }];
    expect(blocksOf(SALE, lonely).every((b) => !b.pinned)).toBe(true);
  });

  it("ignores a pin that does not keep its lots together", () => {
    const loose: OrderPin[] = [{ keepsTogether: false, lotIds: ["b", "c"] }];
    expect(blocksOf(SALE, loose).map((b) => b.lotIds)).toEqual([
      ["a"], ["b"], ["c"], ["d"], ["e"], ["f"],
    ]);
  });

  it("says where a lot is, and -1 for one the sale does not hold", () => {
    expect(blockIndexOf(blocksOf(SALE, PINS), "c")).toBe(1);
    expect(blockIndexOf(blocksOf(SALE, PINS), "zz")).toBe(-1);
  });
});

describe("moving a lot", () => {
  it("puts it before the lot it was dropped on", () => {
    expect(moveBefore(SALE, [], "e", "b")).toEqual(["a", "e", "b", "c", "d", "f"]);
  });

  it("puts it at the end when there is nothing to drop before", () => {
    expect(moveBefore(SALE, [], "a", null)).toEqual(["b", "c", "d", "e", "f", "a"]);
  });

  it("moves the whole pin when any member is dragged", () => {
    // THE MECHANISM. Dragging c moves b with it, because they are one thing.
    const after = moveBefore(SALE, PINS, "c", "a");
    expect(after).toEqual(["b", "c", "a", "d", "e", "f"]);
    expect(together(after, ["b", "c"])).toBe(true);
  });

  /**
   * THE CASE THIS WHOLE MODULE EXISTS FOR. Dropping onto a lot inside a
   * pinned run cannot mean "between its members", because they are not two
   * places. It resolves to the run's own position.
   */
  it("cannot land inside a pin, because there is no inside to land in", () => {
    const after = moveBefore(SALE, PINS, "f", "c");
    expect(together(after, ["b", "c"])).toBe(true);
    // f took the run's place; the run follows it.
    expect(after).toEqual(["a", "f", "b", "c", "d", "e"]);
  });

  it("does nothing when a drag ends where it began", () => {
    // A no-op must not renumber the sale: every position write bumps the
    // catalogue and invalidates every open preview in the building.
    expect(moveBefore(SALE, [], "c", "c")).toEqual(SALE);
    // Including onto a sibling in the same pin, which is the same place.
    expect(moveBefore(SALE, PINS, "b", "c")).toEqual(SALE);
  });

  it("does nothing for a lot or a target the sale does not hold", () => {
    expect(moveBefore(SALE, [], "zz", "a")).toEqual(SALE);
    expect(moveBefore(SALE, [], "a", "zz")).toEqual(SALE);
  });
});

describe("the keyboard moves by the same rules", () => {
  it("steps a lot up and down one block at a time", () => {
    expect(nudge(SALE, [], "c", "up")).toEqual(["a", "c", "b", "d", "e", "f"]);
    expect(nudge(SALE, [], "c", "down")).toEqual(["a", "b", "d", "c", "e", "f"]);
  });

  it("steps OVER a pin rather than into it", () => {
    // d moving up passes the whole b+c run, not one of its members.
    const after = nudge(SALE, PINS, "d", "up");
    expect(after).toEqual(["a", "d", "b", "c", "e", "f"]);
    expect(together(after, ["b", "c"])).toBe(true);
  });

  it("moves a pin as a unit from the keyboard too", () => {
    expect(nudge(SALE, PINS, "b", "up")).toEqual(["b", "c", "a", "d", "e", "f"]);
  });

  it("stops at the ends rather than wrapping", () => {
    // Wrapping is the surprise that makes somebody lose their place: lot 1
    // becoming lot 160 is not what "up" means at the top of a list.
    expect(nudge(SALE, [], "a", "up")).toEqual(SALE);
    expect(nudge(SALE, [], "f", "down")).toEqual(SALE);
  });

  it("reaches the last place, which an off-by-one would make unreachable", () => {
    expect(nudge(SALE, [], "e", "down")).toEqual(["a", "b", "c", "d", "f", "e"]);
  });
});

describe("the property: no move can break a pin", () => {
  /**
   * EVERY LOT AGAINST EVERY DESTINATION, drags and keyboard alike. A handful
   * of chosen cases would have passed against an implementation that moved a
   * single member whenever the drop target happened to be elsewhere; this is
   * what makes the claim a claim about the function rather than about six
   * examples.
   */
  const pins: OrderPin[] = [
    { keepsTogether: true, lotIds: ["b", "c"] },
    { keepsTogether: true, lotIds: ["e", "f"] },
  ];

  it("holds over every drag in a two-pin sale", () => {
    for (const lotId of SALE) {
      for (const target of [...SALE, null]) {
        const after = moveBefore(SALE, pins, lotId, target);
        const where = `moving ${lotId} before ${target ?? "the end"}`;
        expect(isPermutation(after, SALE), `${where} lost or duplicated a lot`).toBe(true);
        expect(together(after, ["b", "c"]), `${where} split b+c`).toBe(true);
        expect(together(after, ["e", "f"]), `${where} split e+f`).toBe(true);
      }
    }
  });

  it("holds over every keyboard step, repeated until nothing moves", () => {
    for (const lotId of SALE) {
      for (const direction of ["up", "down"] as const) {
        let order = [...SALE];
        // Walked to the end of the list rather than stepped once: the
        // interesting failures are the ones that need two moves to appear.
        for (let i = 0; i < SALE.length + 2; i++) {
          order = nudge(order, pins, lotId, direction);
          const where = `${lotId} ${direction} ×${i + 1}`;
          expect(isPermutation(order, SALE), `${where} lost a lot`).toBe(true);
          expect(together(order, ["b", "c"]), `${where} split b+c`).toBe(true);
          expect(together(order, ["e", "f"]), `${where} split e+f`).toBe(true);
        }
      }
    }
  });
});
