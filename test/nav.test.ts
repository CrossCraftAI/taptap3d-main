// The rail's map from a URL to a box of the operator's cycle.
//
// It is a pure function of a pathname, so it is held here rather than only by
// driving a browser — and the things that go wrong with a navigation are exactly
// the things a unit test is good at: two items lighting up at once, an item
// pointing at a page that does not exist, and a category quietly acquiring a
// link it was only ever supposed to name.

import { existsSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { NAV, activeItem } from "@/lib/nav";

const ROOT = path.resolve(import.meta.dirname, "..");

const items = NAV.flatMap((category) =>
  category.items.map((item) => ({ category, item })),
);

describe("the rail points at pages that exist", () => {
  // A dead menu item is the worst outcome of a reorganisation: it makes a
  // working product look broken, in front of a customer, at the exact moment
  // someone is exploring. The e2e suite clicks every one of these; this fails
  // in a second instead of in a browser.
  it.each(items.map(({ item }) => item.href))("%s has a page", (href) => {
    const segment = href === "/" ? "" : href;
    expect(existsSync(path.join(ROOT, "src", "app", segment, "page.tsx"))).toBe(
      true,
    );
  });

  it("names every place exactly once", () => {
    const hrefs = items.map(({ item }) => item.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });
});

describe("a category with nothing behind it has nothing to click", () => {
  // DFD.md §2: "named only" must not become an empty table shipped in advance.
  // The rail's version of that rule is that Move, Connect and Admin hold no
  // items at all — which is what makes it impossible for one to render as a
  // link, because the component has no href to give it.
  it.each(["move", "connect", "admin"])("%s holds no items", (id) => {
    const category = NAV.find((c) => c.id === id);
    expect(category, `${id} is missing from the rail`).toBeDefined();
    expect(category!.items).toEqual([]);
  });

  it("every category says what it is for", () => {
    // The named-but-empty ones are the reason this is required rather than
    // decorative: a bare noun on a rail is a promise nobody can read.
    for (const category of NAV) {
      expect(category.hint.length).toBeGreaterThan(20);
    }
  });
});

describe("which function a screen belongs to", () => {
  it.each([
    // The landing and an event's own screens are recording.
    ["/", "record", "Events"],
    ["/events/abc", "record", "Events"],
    ["/events/abc/lots/def", "record", "Events"],
    ["/import", "record", "Import"],
    // AN EVENT'S IMPORT IS IMPORTING, not "events". This is the whole point of
    // the reorganisation: the rail says which part of the cycle you are in, and
    // under an asset-first rail all four of these rows read "Events".
    ["/events/abc/import", "record", "Import"],
    ["/photographs", "capture", "Photographs"],
    ["/catalogues", "compose", "Catalogue"],
    ["/events/abc/catalogue", "compose", "Catalogue"],
    ["/exports", "publish", "PDF export"],
  ])("%s is %s → %s", (pathname, categoryId, label) => {
    const active = activeItem(pathname);
    expect(active?.categoryId).toBe(categoryId);
    expect(active?.item.label).toBe(label);
  });

  it("claims a path for exactly one item", () => {
    // Two highlighted rows is not a cosmetic bug: it means a person cannot tell
    // from the rail what they are looking at, which is the only job it has.
    for (const pathname of [
      "/",
      "/import",
      "/events/abc",
      "/events/abc/import",
      "/events/abc/catalogue",
      "/photographs",
      "/catalogues",
      "/exports",
    ]) {
      const matched = items.filter(({ item }) => item.match(pathname));
      expect(matched.map(({ item }) => item.label), pathname).toHaveLength(1);
    }
  });

  it("claims nothing it has no place for", () => {
    // An endpoint is not a screen and answering "none" for one is correct; a
    // rail that lit a row up for /api/health would be guessing.
    expect(activeItem("/api/health")).toBeNull();
    // The preview frame and the printed export, though, are the catalogue seen
    // through a different door, and they belong to the category that owns it.
    expect(activeItem("/events/abc/catalogue/preview")?.categoryId).toBe(
      "compose",
    );
  });
});
