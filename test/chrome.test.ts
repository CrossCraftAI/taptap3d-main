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
  RAIL_ICONS,
  RAIL_WIDE,
  RAIL_WIDTH,
  TOP_BAR,
  WIDTH_DEFAULT,
  applyBeforePaint,
  applyWidthBeforePaint,
  isOpen,
  railDefault,
  widthOf,
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

  it("leaves the rail's width alone, because it is not its decision", () => {
    // TWO CONTROLS, TWO KEYS — and the thing that proves they are independent
    // is that neither script reads the other's key. A viewer who puts the
    // navigation away and brings it back gets the width they work in, and
    // that is only true while this holds.
    const seen: string[] = [];
    const storage = {
      getItem(key: string) {
        seen.push(key);
        return null;
      },
    };
    run(RAIL, true, storage);
    expect(seen).toEqual([RAIL.key]);
    expect(seen).not.toContain(RAIL_WIDTH.key);
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

// ── The rail's second decision ──────────────────────────────────────────────
//
// The rail has three states — away, icons, full — and two controls, and
// src/lib/chrome.ts argues at length why it is not one control cycling three
// ways: whether the navigation is HERE is a momentary gesture, how wide it is
// when it is here is a standing preference, and putting both on one control
// makes every momentary gesture overwrite the preference.
//
// What that costs is a second key and a second before-paint script, and the
// two things that can go wrong with them are exactly what is held below: the
// script and the reader disagreeing about a stored value, and the two
// decisions leaking into each other.

describe("the rail's width is its own decision", () => {
  it("is a separate key, shared with nothing else", () => {
    // A width stored under the rail's own key would be read by `isOpen` as
    // neither "open" nor "closed" — the route default — so a viewer who chose
    // the icon rail would find the whole navigation gone on the editor.
    expect(PARTS.map((part) => part.key)).not.toContain(RAIL_WIDTH.key);
  });

  it("is the same element as the rail, on purpose", () => {
    // There is one rail. The width is a value it carries rather than a second
    // thing beside it, so the two scripts write two different attributes onto
    // the one element — and the two controls stay two buttons.
    expect(RAIL_WIDTH.id).toBe(RAIL.id);
    expect(RAIL_WIDTH.toggle).not.toBe(RAIL.toggle);
  });

  it("starts full, and does not vary by route", () => {
    // `railDefault` is per-route because the editor's page area is measured
    // arithmetic. A width is a preference, and a preference that changes
    // screen to screen is the rail with a mind of its own.
    expect(WIDTH_DEFAULT).toBe("full");
  });

  it("narrows to the width the palette's spine already has", () => {
    // Not the drawing's 46: the shell paints one icon column already and two
    // of them two pixels apart read as a mistake. 44 is also `--tap` under a
    // coarse pointer, and in this one column the control IS the column.
    expect(RAIL_ICONS).toBe(44);
    expect(RAIL_WIDE).toBeGreaterThan(RAIL_ICONS);
  });
});

describe("a stored width wins; anything else is the default", () => {
  it.each([
    ["icons", "full", "icons"],
    ["full", "icons", "full"],
    [null, "full", "full"],
    [null, "icons", "icons"],
    // The rail's OWN vocabulary, arriving on the width's key. It is the value
    // a hand-edited storage entry is most likely to hold, and reading "open"
    // as "full" would be a guess — so it is neither, and the default stands.
    ["open", "full", "full"],
    ["closed", "icons", "icons"],
    ["", "full", "full"],
    [42, "full", "full"],
    [undefined, "icons", "icons"],
  ] as const)("%j at default %s → %s", (stored, fallback, expected) => {
    expect(widthOf(stored, fallback)).toBe(expected);
  });
});

describe("the width's before-paint script does what widthOf does", () => {
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

  function apply(
    fallback: "full" | "icons",
    storage: { getItem(key: string): string | null },
  ): { rail: string | undefined; pressed: string | undefined } {
    const element = stub();
    const button = stub();
    const document = {
      getElementById: (id: string) =>
        id === RAIL_WIDTH.id ? element : id === RAIL_WIDTH.toggle ? button : null,
    };
    new Function("document", "localStorage", applyWidthBeforePaint(RAIL_WIDTH, fallback))(
      document,
      storage,
    );
    return {
      rail: element.attrs.get("data-rail"),
      pressed: button.attrs.get("aria-pressed"),
    };
  }
  const storing = (value: string | null) => ({ getItem: () => value });

  it.each([
    ["icons", "full"],
    ["icons", "icons"],
    ["full", "full"],
    ["full", "icons"],
    [null, "full"],
    [null, "icons"],
    ["nonsense", "full"],
    ["nonsense", "icons"],
  ] as const)("agrees with widthOf for %j at default %s", (stored, fallback) => {
    const expected = widthOf(stored, fallback);
    const result = apply(fallback, storing(stored));
    // The ATTRIBUTE is the mechanism: every class that differs between the
    // two widths is a `data-[rail=…]` variant of this value, so a script that
    // wrote a third word would silently paint the full rail.
    expect(result.rail).toBe(expected);
    expect(result.pressed).toBe(expected === "icons" ? "true" : "false");
  });

  it("falls back to the default when storage throws, and does not itself throw", () => {
    const throwing = {
      getItem(): string | null {
        throw new Error("SecurityError: a private window");
      },
    };
    expect(apply("full", throwing)).toEqual({ rail: "full", pressed: "false" });
    expect(apply("icons", throwing)).toEqual({ rail: "icons", pressed: "true" });
  });

  it("does nothing when the rail is not on the page", () => {
    // Below 768 the rail is not rendered at all, and the script still runs.
    expect(() =>
      new Function("document", "localStorage", applyWidthBeforePaint(RAIL_WIDTH, "full"))(
        { getElementById: () => null },
        storing("icons"),
      ),
    ).not.toThrow();
  });

  it("reads the width's key and nobody else's", () => {
    const seen: string[] = [];
    apply("full", {
      getItem(key) {
        seen.push(key);
        return null;
      },
    });
    expect(seen).toEqual([RAIL_WIDTH.key]);
  });
});
