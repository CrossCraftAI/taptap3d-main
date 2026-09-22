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

import {
  NAV,
  activeItem,
  currentItem,
  navGroups,
  openEventId,
  saleNav,
  switchEvent,
} from "@/lib/nav";

const ROOT = path.resolve(import.meta.dirname, "..");

/** An id shaped like a real one, so a path is exercised rather than a stub. */
const EVENT = "11111111-2222-3333-4444-555555555555";

/** Every item the rail can ever draw, both groups, with an event open. */
const EVERY = navGroups(EVENT).flatMap((group) => [...group.items]);

describe("the rail points at pages that exist", () => {
  // A dead menu item is the worst outcome of a reorganisation: it makes a
  // working product look broken, in front of a customer, at the exact moment
  // someone is exploring. The e2e suite clicks every one of these; this fails
  // in a second instead of in a browser.
  //
  // The ROUTE PATTERN is what is checked, not the filled-in href: "/events/
  // [id]/catalogue" is a directory on disk, and a path built from an id is a
  // plain string that `typedRoutes` cannot check at all.
  it.each(EVERY.map((item) => item.route))("%s has a page", (route) => {
    const segment = route === "/" ? "" : route;
    expect(existsSync(path.join(ROOT, "src", "app", segment, "page.tsx"))).toBe(
      true,
    );
  });

  it("fills every dynamic segment of the href it hands the link", () => {
    // A bracket left in an href is a 404 that looks like a working link, and
    // it is the exact failure mode of building paths by string.
    for (const item of EVERY) {
      expect(item.href, item.label).not.toContain("[");
      expect(item.href.startsWith("/"), item.label).toBe(true);
    }
  });

  it("names every place exactly once", () => {
    const hrefs = EVERY.map((item) => item.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });
});

describe("the rail is two groups of what is built", () => {
  // THE OWNER'S DECISION, held as a test. The rail was seven categories — a
  // sequence of four and three "not yet" labels — and was rejected for filing
  // a pipeline as a menu. It was then four places and no categories, because
  // four items about one subject do not need a filing system.
  //
  // It is now FOUR places in two groups, and what changed is the list rather
  // than the taste: two of the four are about the one event you have open.
  //
  // The house lost two the same day it gained the groups. `/catalogues` and
  // `/exports` were one component over the same rows with a different verb,
  // and the verb is now the row's own next action — so a rail that listed them
  // was offering two more doors into the table it already had a door to.
  // Changing this is a product decision; change it here and in
  // test/e2e/rail.spec.ts together, on purpose.
  it("names the house's two places, in this order", () => {
    expect(NAV.map((item) => item.label)).toEqual(["Events", "Photographs"]);
  });

  it("names the event's two places, in this order", () => {
    expect(saleNav(EVENT).map((item) => item.label)).toEqual(["Editor", "Lots"]);
  });

  it("has no event group at all when no event is open", () => {
    expect(navGroups(null).map((group) => group.key)).toEqual(["house"]);
    // A category that would draw two rows pointing at no event is worse than
    // no category: the rows cannot be built, so the group is not there.
    expect(navGroups(EVENT).map((group) => group.key)).toEqual(["sale", "house"]);
  });

  it("carries a count only where there is something to count", () => {
    // Events and photographs are the two things a house accumulates, and they
    // are the whole house list. The event's own places carry none — the shell does not know that sale's lot
    // count, and a number the chrome cannot read is not a number it may show.
    expect(EVERY.filter((item) => item.count).map((item) => item.label)).toEqual([
      "Events",
      "Photographs",
    ]);
  });
});

describe("which event a path is inside", () => {
  it.each([
    ["/", null],
    ["/photographs", null],
    ["/photographs?filter=unassigned", null],
    ["/events/abc", "abc"],
    ["/events/abc/", "abc"],
    ["/events/abc/import", "abc"],
    ["/events/abc/catalogue", "abc"],
    ["/events/abc/lots/def", "abc"],
    // Not an event, and answering "" would make the chrome build /events//…
    ["/events", null],
    ["/events/", null],
  ])("%s → %j", (pathname, id) => {
    expect(openEventId(pathname)).toBe(id);
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
    // AN EVENT'S CATALOGUE IS THE EVENTS, now that there is no Catalogues to
    // be. This is the house list, which has no event open, so the editor has
    // only one honest home; the moment an event IS open its own Editor row
    // claims it first (see the innermost-mark cases below).
    ["/events/abc/catalogue", "Events"],
    ["/events/abc/catalogue/preview", "Events"],
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

describe("exactly one mark, and it is the innermost true one", () => {
  // An editor path is honestly both the event's Editor and the house's Events.
  // Both marked leaves a person unable to read their position off the rail,
  // which is the rail's only job. The overlap did not go away when Catalogues
  // did — it moved, because Events now claims everything under /events on
  // purpose, so that the editor marks SOMETHING when no event group is drawn.
  it.each([
    [`/events/${EVENT}/catalogue`, "Editor"],
    [`/events/${EVENT}/catalogue/preview`, "Editor"],
    [`/events/${EVENT}`, "Lots"],
    [`/events/${EVENT}/import`, "Lots"],
    [`/events/${EVENT}/lots/xyz`, "Lots"],
    // A path inside ANOTHER event: the open event's group does not claim it,
    // and the house's Events does.
    ["/events/other", "Events"],
    ["/photographs", "Photographs"],
    ["/", "Events"],
  ])("%s is marked %s", (pathname, label) => {
    const groups = navGroups(EVENT);
    expect(currentItem(groups, pathname)?.label).toBe(label);
    const marked = groups.flatMap((group) =>
      group.items.filter((item) => item === currentItem(groups, pathname)),
    );
    expect(marked).toHaveLength(1);
  });

  it("marks nothing for a path no group claims", () => {
    expect(currentItem(navGroups(EVENT), "/api/health")).toBeNull();
  });
});

describe("switching event keeps the screen where it can", () => {
  const A = "aaa";
  const B = "bbb";

  it("stays in the editor, which is the screen the switcher exists for", () => {
    expect(switchEvent(`/events/${A}/catalogue`, B)).toBe(`/events/${B}/catalogue`);
  });

  it.each([
    // A lot belongs to ONE event; carrying the tail across would build a 404
    // by hand, which is worse than landing somewhere real.
    [`/events/${A}/lots/xyz`],
    // A half-finished import is a task in progress, not a place.
    [`/events/${A}/import`],
    [`/events/${A}/catalogue/preview`],
    [`/events/${A}`],
    ["/photographs"],
    ["/"],
  ])("lands on the event itself from %s", (pathname) => {
    expect(switchEvent(pathname, B)).toBe(`/events/${B}`);
  });

  it("only ever names the event it was asked for", () => {
    for (const pathname of [`/events/${A}/catalogue`, `/events/${A}/lots/x`, "/"]) {
      expect(switchEvent(pathname, B)).not.toContain(A);
    }
  });
});
