// The rail's map from a URL to a place.
//
// It is a pure function of a pathname, so it is held here rather than only by
// driving a browser — and the things that go wrong with a navigation are exactly
// the things a unit test is good at: two items lighting up at once, an item
// pointing at a page that does not exist, and a list quietly growing a label
// that is not a place.

import { existsSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { NAV, activeItem } from "@/lib/nav";

const ROOT = path.resolve(import.meta.dirname, "..");

describe("the rail points at pages that exist", () => {
  // A dead menu item is the worst outcome of a reorganisation: it makes a
  // working product look broken, in front of a customer, at the exact moment
  // someone is exploring. The e2e suite clicks every one of these; this fails
  // in a second instead of in a browser.
  it.each(NAV.map((item) => item.href))("%s has a page", (href) => {
    const segment = href === "/" ? "" : href;
    expect(existsSync(path.join(ROOT, "src", "app", segment, "page.tsx"))).toBe(
      true,
    );
  });

  it("names every place exactly once", () => {
    const hrefs = NAV.map((item) => item.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });
});

describe("the rail is a flat list of what is built", () => {
  // THE OWNER'S DECISION, held as a test. The rail was seven categories — a
  // sequence of four and three "not yet" labels — and was rejected for filing
  // a pipeline as a menu. It is now these four places and nothing else: no
  // category, no label without a page, no roadmap entry pretending to be a
  // feature. Changing this list is a product decision; change it here and in
  // test/e2e/rail.spec.ts together, on purpose.
  it("names the four places, in this order", () => {
    expect(NAV.map((item) => item.label)).toEqual([
      "Events",
      "Photographs",
      "Catalogues",
      "Exports",
    ]);
  });

  it("carries a count only where there is something to count", () => {
    // Events and photographs are the two things a house accumulates; a count
    // on Catalogues would be a count of rows nobody chose to create.
    expect(NAV.filter((item) => item.count).map((item) => item.label)).toEqual([
      "Events",
      "Photographs",
    ]);
  });
});

describe("which place a screen belongs to", () => {
  it.each([
    // The landing and an event's own screens are the events, including its
    // import: importing is a thing done TO an event, from the event's header.
    ["/", "Events"],
    ["/events/abc", "Events"],
    ["/events/abc/import", "Events"],
    ["/events/abc/lots/def", "Events"],
    ["/photographs", "Photographs"],
    ["/photographs?filter=unassigned", "Photographs"],
    // AN EVENT'S CATALOGUE IS THE CATALOGUES. A person laying out pages is in
    // the catalogues whichever sale it is, and the rail should say so.
    ["/catalogues", "Catalogues"],
    ["/events/abc/catalogue", "Catalogues"],
    ["/events/abc/catalogue/preview", "Catalogues"],
    ["/exports", "Exports"],
  ])("%s is %s", (pathname, label) => {
    expect(activeItem(pathname)?.label).toBe(label);
  });

  it("claims a path for exactly one item", () => {
    // Two highlighted rows is not a cosmetic bug: it means a person cannot tell
    // from the rail what they are looking at, which is the only job it has.
    for (const pathname of [
      "/",
      "/events/abc",
      "/events/abc/import",
      "/events/abc/catalogue",
      "/photographs",
      "/catalogues",
      "/exports",
    ]) {
      const matched = NAV.filter((item) => item.match(pathname));
      expect(matched.map((item) => item.label), pathname).toHaveLength(1);
    }
  });

  it("claims nothing it has no place for", () => {
    // An endpoint is not a screen and answering "none" for one is correct; a
    // rail that lit a row up for /api/health would be guessing.
    expect(activeItem("/api/health")).toBeNull();
    expect(activeItem("/api/assets/abc")).toBeNull();
  });
});
