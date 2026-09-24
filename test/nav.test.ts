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
  SWITCHER_ROWS,
  activeItem,
  currentItem,
  navGroups,
  openEventId,
  saleNav,
  switchEvent,
  switcherRows,
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

  it("names the event's four places, in this order", () => {
    // Editor and Lots first because they are about the SALE; Condition and
    // Movement after, because they are about one object in it and are reached
    // from a row. The order is pinned here rather than left to the array,
    // because `currentItem` takes the first matcher that claims a path — so
    // this list's order is behaviour and not presentation.
    expect(saleNav(EVENT).map((item) => item.label)).toEqual([
      "Editor",
      "Lots",
      "Condition",
      "Movement",
    ]);
  });

  it("marks a register from a lot's own copy of it as well as the sale's", () => {
    // Each register exists at two altitudes. A person who followed a row down
    // into one lot is still in Condition, and the rail has to say so or it
    // marks Lots and contradicts the heading.
    const groups = navGroups(EVENT);
    for (const tail of ["condition", "movement"] as const) {
      const label = tail === "condition" ? "Condition" : "Movement";
      expect(currentItem(groups, `/events/${EVENT}/${tail}`)?.label).toBe(label);
      expect(currentItem(groups, `/events/${EVENT}/lots/xyz/${tail}`)?.label).toBe(label);
    }
    // And the thing they were carved out of still claims everything else.
    expect(currentItem(groups, `/events/${EVENT}/lots/xyz`)?.label).toBe("Lots");
    expect(currentItem(groups, `/events/${EVENT}/import`)?.label).toBe("Lots");
  });

  it("has no event group at all when no event is open", () => {
    expect(navGroups(null).map((group) => group.key)).toEqual(["house"]);
    // A category that would draw two rows pointing at no event is worse than
    // no category: the rows cannot be built, so the group is not there.
    expect(navGroups(EVENT).map((group) => group.key)).toEqual(["sale", "house"]);
  });

  it("carries a count only where there is something to count", () => {
    // Events and photographs are the two things a house accumulates, and they
    // are the whole house list. Lots is the sale's own size, and it is here
    // because the shell CAN read it: `listEventChoices` already returns a
    // lotCount per event for the palette, so the rail's number is the same
    // lookup rather than a second query. The sale's group is drawn first, so
    // Lots comes first in this flattened list.
    //
    // The Editor carries none: a catalogue's only honest count is the lot
    // count again.
    expect(EVERY.filter((item) => item.count).map((item) => item.label)).toEqual([
      "Lots",
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

describe("the switcher draws ten of them and searches all of them", () => {
  // THE FAILURE THIS EXISTS FOR: a capped list that drops the row you are
  // standing on. The shell measured 485 painted rows and 367KB of HTML on the
  // ledger with 484 sales in the org; capping the paint is what fixed that,
  // and the thing capping can get wrong is a question about an array.
  const sales = Array.from({ length: 40 }, (_, i) => ({
    id: `e${i}`,
    // Newest first, as `listEventChoices` orders them.
    name: i === 7 ? "Spring Bronzes" : `Sale ${i}`,
    note: i === 7 ? "04 Apr 2026 · 12 lots" : `${i} lots`,
  }));

  it("draws the cap and says how many there are in all", () => {
    const view = switcherRows(sales, null, "");
    expect(view.shown).toHaveLength(SWITCHER_ROWS);
    expect(view.shown.map((s) => s.id)).toEqual(
      sales.slice(0, SWITCHER_ROWS).map((s) => s.id),
    );
    expect(view.total).toBe(40);
    expect(view.matched).toBe(40);
  });

  it("draws everything when there is less than a cap's worth", () => {
    const few = sales.slice(0, 3);
    expect(switcherRows(few, null, "").shown).toHaveLength(3);
  });

  it("keeps the open one on the list when recency would drop it", () => {
    // The whole point. `e30` is nowhere near the ten most recently touched,
    // and it is the sale the viewer is standing in.
    const view = switcherRows(sales, "e30", "");
    expect(view.shown).toHaveLength(SWITCHER_ROWS);
    expect(view.shown.map((s) => s.id)).toContain("e30");
    // In the LAST slot, not the first: the list is newest-first and the one
    // that fell outside the cap is the oldest-touched thing on it.
    expect(view.shown.at(-1)?.id).toBe("e30");
    // And it took a slot rather than adding one.
    expect(view.shown.map((s) => s.id).slice(0, -1)).toEqual(
      sales.slice(0, SWITCHER_ROWS - 1).map((s) => s.id),
    );
  });

  it("leaves the open one where recency put it when it is already there", () => {
    const view = switcherRows(sales, "e2", "");
    expect(view.shown.map((s) => s.id)).toEqual(
      sales.slice(0, SWITCHER_ROWS).map((s) => s.id),
    );
  });

  it("searches every sale, not the ten that are drawn", () => {
    // `Spring Bronzes` is the eighth, so this would pass even uncapped; `Sale
    // 33` is the case that matters — it is off the end of every drawn list.
    expect(switcherRows(sales, null, "Sale 33").shown.map((s) => s.id)).toEqual([
      "e33",
    ]);
    expect(switcherRows(sales, null, "bronze").shown.map((s) => s.id)).toEqual([
      "e7",
    ]);
  });

  it("reads the note as well as the name", () => {
    // The date and the lot count live in the note, and "2026" is a thing
    // somebody types to find a sale.
    expect(switcherRows(sales, null, "Apr 2026").matched).toBe(1);
  });

  it("caps the matches too, and says how many there were", () => {
    const view = switcherRows(sales, null, "Sale ");
    expect(view.shown).toHaveLength(SWITCHER_ROWS);
    // 39 of the 40 are named "Sale n"; the fortieth is Spring Bronzes.
    expect(view.matched).toBe(39);
    expect(view.total).toBe(40);
  });

  it("does not force the open one into a result set that excludes it", () => {
    // A search that hands back something it was not asked for is a search
    // nobody can trust. The tick is simply not among these.
    const view = switcherRows(sales, "e30", "Sale 1");
    expect(view.shown.map((s) => s.id)).not.toContain("e30");
  });

  it("matches nothing rather than everything for a word that is not there", () => {
    const view = switcherRows(sales, null, "porcelain");
    expect(view.shown).toHaveLength(0);
    expect(view.matched).toBe(0);
    // The panel's empty state says how much there was to match against, so
    // the total has to survive a query that matched none of it.
    expect(view.total).toBe(40);
  });

  it("treats whitespace as no query at all", () => {
    expect(switcherRows(sales, null, "   ").matched).toBe(40);
  });

  it("ignores case, because nobody types a sale's capitals", () => {
    expect(switcherRows(sales, null, "SPRING").matched).toBe(1);
  });
});
