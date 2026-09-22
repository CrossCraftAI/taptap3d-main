// The guard both keyboard shortcuts stand on.
//
// It is eight lines and it is the difference between a shortcut and a defect:
// the rail's Ctrl+\ and the lot stepper's ← / → both listen on the window, so
// both see every keystroke aimed at a form. Held here because it is now
// shared (src/lib/keys.ts) and a shared thing drifts silently — the driven
// specs press the keys on a page whose fields happen to be empty, and would
// not notice a guard that had stopped guarding.
//
// Duck-typed objects, not a DOM: the function is duck-typed on purpose
// (ARCHITECTURE.md, "instanceof lies across realms"), and testing it through
// real elements would test jsdom's constructors instead of the contract.

import { describe, expect, it } from "vitest";

import { isTyping } from "@/lib/keys";

/** The shape a real event target presents to the guard, and nothing else. */
const target = (shape: { tagName?: string; isContentEditable?: boolean }): EventTarget =>
  shape as unknown as EventTarget;

describe("a keystroke aimed at a field is not a command", () => {
  it.each([
    ["INPUT", true],
    ["TEXTAREA", true],
    // SELECT, because a select consumes arrow keys to change its own value —
    // the stepper would move the lot AND the option.
    ["SELECT", true],
    ["BUTTON", false],
    ["A", false],
    ["BODY", false],
    ["DIV", false],
  ])("%s → typing: %s", (tagName, expected) => {
    expect(isTyping(target({ tagName }))).toBe(expected);
  });

  it("counts a contenteditable, whatever it is made of", () => {
    expect(isTyping(target({ tagName: "DIV", isContentEditable: true }))).toBe(true);
    expect(isTyping(target({ tagName: "DIV", isContentEditable: false }))).toBe(false);
  });

  it("says no for a target that is not an element at all", () => {
    // `event.target` is the document or the window for a keystroke with
    // nothing focused, and neither has a tagName. A shortcut must still work
    // there — that is the whole point of listening on the window.
    expect(isTyping(null)).toBe(false);
    expect(isTyping(target({}))).toBe(false);
  });
});
