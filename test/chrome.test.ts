// The chrome a viewer puts away — pure, so it is held here beside the rail's
// map rather than only by driving a browser.
//
// The part that matters is the last block. The before-paint script is a
// STRING the browser runs before React exists (src/lib/chrome.ts); if it and
// `isOpen` ever disagreed, hydration would meet a DOM it did not render and
// the rail would flash or, worse, say one thing and show another. So the
// string is executed here against a document of two elements and every kind
// of storage — including the kind that throws.

import { describe, expect, it } from "vitest";

import {
  LOTS_PANEL,
  NAV_HOUSE,
  NAV_SALE,
  PALETTE,
  RAIL,
  TOP_BAR,
  applyBeforePaint,
  isOpen,
  railDefault,
  type Collapsible,
} from "@/lib/chrome";

/** Every part of the chrome a viewer can put away. */
const PARTS: Collapsible[] = [RAIL, TOP_BAR, NAV_SALE, NAV_HOUSE, PALETTE, LOTS_PANEL];

describe("where the rail is by default", () => {
  it.each([
    ["/", true],
    ["/events/abc", true],
    ["/events/abc/import", true],
    ["/events/abc/lots/def", true],
    ["/photographs", true],
    // THE EDITOR TAKES THE WINDOW. Measured before: 22.1% of it was the page.
    ["/events/abc/catalogue", false],
  ])("%s → open: %s", (pathname, open) => {
    expect(railDefault(pathname)).toBe(open);
  });
});

describe("the parts of the chrome are told apart", () => {
  it("gives each part its own element and its own toggle", () => {
    // Two parts sharing an id is a before-paint script that hides the wrong
    // thing, and the symptom is a panel that will not open with no error
    // anywhere.
    const ids = PARTS.map((part) => part.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives each INDEPENDENT part its own key", () => {
    const independent = PARTS.filter((part) => part !== TOP_BAR);
    const keys = independent.map((part) => part.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("puts the top bar on the rail's key on purpose", () => {
    // One control is labelled "Navigation" and both of these ARE the
    // navigation; a second key is a second thing to get out of step, and a
    // viewer who hid the navigation and got half of it back on the next page
    // would rightly call it a bug. Two elements, one decision.
    expect(TOP_BAR.key).toBe(RAIL.key);
    expect(TOP_BAR.toggle).toBe(RAIL.toggle);
    expect(TOP_BAR.id).not.toBe(RAIL.id);
  });
});

describe("a stored choice wins; anything else is the default", () => {
  it.each([
    ["open", false, true],
    ["closed", true, false],
    [null, true, true],
    [null, false, false],
    ["", true, true],
    ["yes", false, false],
    [42, true, true],
    [undefined, false, false],
  ])("%j at default %s → %s", (stored, fallback, expected) => {
    expect(isOpen(stored, fallback)).toBe(expected);
  });
});

describe("the before-paint script does exactly what the component does", () => {
  interface Stub {
    attrs: Map<string, string>;
    setAttribute(name: string, value: string): void;
    removeAttribute(name: string): void;
  }
  const stub = (): Stub => ({
    attrs: new Map(),
    setAttribute(name, value) {
      this.attrs.set(name, value);
    },
    removeAttribute(name) {
      this.attrs.delete(name);
    },
  });

  function run(
    part: Collapsible,
    fallback: boolean,
    storage: { getItem(key: string): string | null },
  ): { hidden: boolean; expanded: string | undefined } {
    const element = stub();
    const button = stub();
    const document = {
      getElementById: (id: string) =>
        id === part.id ? element : id === part.toggle ? button : null,
    };
    // The script names `document` and `localStorage` as free identifiers;
    // making them parameters is how a browser global is stood in for here.
    new Function("document", "localStorage", applyBeforePaint(part, fallback))(
      document,
      storage,
    );
    return { hidden: element.attrs.has("hidden"), expanded: button.attrs.get("aria-expanded") };
  }
  const storing = (value: string | null) => ({ getItem: () => value });
  const throwing = {
    getItem(): string | null {
      throw new Error("SecurityError: a private window");
    },
  };

  it.each([
    ["open", true],
    ["open", false],
    ["closed", true],
    ["closed", false],
    [null, true],
    [null, false],
    ["nonsense", true],
    ["nonsense", false],
  ])("agrees with isOpen for %j at default %s", (stored, fallback) => {
    const expected = isOpen(stored, fallback);
    const result = run(RAIL, fallback, storing(stored));
    expect(result.hidden).toBe(!expected);
    expect(result.expanded).toBe(String(expected));
  });

  it("falls back to the default when storage throws, and does not itself throw", () => {
    // A private window throws on access rather than answering nothing. A rail
    // that cannot render is worse than a rail that forgets.
    expect(run(RAIL, true, throwing)).toEqual({ hidden: false, expanded: "true" });
    expect(run(LOTS_PANEL, false, throwing)).toEqual({ hidden: true, expanded: "false" });
  });

  it("does nothing when the elements are not on the page", () => {
    const script = applyBeforePaint(RAIL, false);
    expect(() =>
      new Function("document", "localStorage", script)(
        { getElementById: () => null },
        storing("open"),
      ),
    ).not.toThrow();
  });

  it("reads each part's own key and nobody else's", () => {
    for (const part of PARTS) {
      const seen: string[] = [];
      run(part, true, {
        getItem(key) {
          seen.push(key);
          return null;
        },
      });
      expect(seen).toEqual([part.key]);
    }
    expect(RAIL.key).not.toBe(LOTS_PANEL.key);
  });

  it("applies the same choice to the rail and the top bar", () => {
    // They are two elements on one key, so one stored answer has to leave both
    // in the same state — including the state the server did NOT render,
    // which is the whole reason the script exists.
    for (const stored of ["open", "closed", null] as const) {
      const rail = run(RAIL, false, storing(stored));
      const bar = run(TOP_BAR, false, storing(stored));
      expect(bar.hidden, String(stored)).toBe(rail.hidden);
      expect(bar.expanded, String(stored)).toBe(rail.expanded);
    }
  });
});
