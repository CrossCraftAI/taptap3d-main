// Which function of the operator's cycle a URL belongs to.
//
// ── WHY THIS IS NOT INSIDE THE COMPONENT ────────────────────────────────────
//
// Two reasons, and the second is the one that matters. It is a pure function of
// a pathname, so it is testable in node beside the engine and the parser rather
// than only by driving a browser. And it is the single place the product's
// vocabulary is written down as something the code can be held to: DFD.md §1
// draws the cycle, and this says which box of it each screen sits in.
//
// ── FUNCTION-FIRST, AND WHAT IT BUYS ────────────────────────────────────────
//
// The rail was asset-first — Events, Photographs — which reads correctly to
// exactly one kind of customer: one who calls their sets "events" and their
// media "photographs". A gallery, a museum and an educator do the same WORK
// under different nouns. So the categories name the work (record, capture,
// compose, publish, move, connect) and the items keep the auction vertical's
// nouns underneath. Nothing forks: no new table, no second data model, no
// per-vertical branch. Only the reading of the same rows changes.
//
// The payoff is visible walking the demo. An event's import screen lights up
// Record; its catalogue lights up Compose. The rail tells a person which part of
// their own cycle they are standing in, which an asset-first rail cannot do at
// all — under it, every one of those screens is just "Events".

import type { Route } from "next";

/** Which of the rail's two numbers belongs beside an item, if either does. */
export type NavCount = "events" | "photographs";

export interface NavItem {
  href: Route;
  label: string;
  count?: NavCount;
  match: (pathname: string) => boolean;
}

export interface NavCategory {
  id: string;
  label: string;
  /** Said to the viewer on hover; said here so the category is not a bare noun. */
  hint: string;
  items: NavItem[];
}

// An event's own screens are matched HERE rather than all collapsing into
// "Events", because that is the whole point of the reorganisation: importing is
// recording and laying out is composing, whichever object you are doing it to.
const EVENT_IMPORT = /^\/events\/[^/]+\/import(\/|$)/;
const EVENT_CATALOGUE = /^\/events\/[^/]+\/catalogue(\/|$)/;

export const NAV: readonly NavCategory[] = [
  {
    id: "record",
    label: "Record",
    hint: "Getting the data in, and finding it again.",
    items: [
      {
        href: "/",
        label: "Events",
        count: "events",
        // Everything under an event that is not one of the other functions —
        // the event itself and its lots. A lot is a record.
        match: (p) =>
          p === "/" ||
          (p.startsWith("/events") &&
            !EVENT_IMPORT.test(p) &&
            !EVENT_CATALOGUE.test(p)),
      },
      {
        href: "/import",
        label: "Import",
        match: (p) => p === "/import" || EVENT_IMPORT.test(p),
      },
    ],
  },
  {
    id: "capture",
    label: "Capture",
    hint: "The photographs, including the ones nobody has filed yet.",
    items: [
      {
        href: "/photographs",
        label: "Photographs",
        count: "photographs",
        match: (p) => p.startsWith("/photographs"),
      },
    ],
  },
  {
    id: "compose",
    label: "Compose",
    hint: "Laying the pages out. The reason this is not a spreadsheet.",
    items: [
      {
        href: "/catalogues",
        label: "Catalogue",
        match: (p) => p === "/catalogues" || EVENT_CATALOGUE.test(p),
      },
    ],
  },
  {
    id: "publish",
    label: "Publish",
    hint: "What leaves the building.",
    items: [
      {
        href: "/exports",
        label: "PDF export",
        match: (p) => p.startsWith("/exports"),
      },
    ],
  },

  // ── FROM HERE DOWN: NAMED, NOT BUILT ──────────────────────────────────────
  //
  // DFD.md §2 is explicit that "named only" must not become an empty table
  // shipped in advance, and ARCHITECTURE.md lists exactly that under what is
  // deliberately absent. The same argument applies to a menu: an item that 404s
  // makes a working product look broken in front of a customer, which is worse
  // than the absence it was meant to paper over.
  //
  // But dropping them entirely loses what the reorganisation was for. A rail
  // that lists only what is built says this is a catalogue tool; a gallery or a
  // museum reading it cannot see where their own work would go. The cycle is the
  // pitch, and the pitch is what these names are for.
  //
  // So they render — as a LABEL with a visible "not yet", with no href, no role
  // and no hover affordance (see src/components/nav.tsx). Nothing to click means
  // nothing that can 404, and the tail says the absence is a decision rather
  // than a fault. An empty `items` array is the entire mechanism: no route, no
  // page, no table, no migration.
  {
    id: "move",
    label: "Move",
    hint: "Custody, location and condition. Named in the cycle; nothing performs it here yet (ROADMAP D10, D12).",
    items: [],
  },
  {
    id: "connect",
    label: "Connect",
    hint: "Channels and integrations. Written when a partner is real (ROADMAP D5).",
    items: [],
  },
  {
    id: "admin",
    label: "Admin",
    hint: "Organisation, people and templates. Waits on sign-in (ROADMAP D14).",
    items: [],
  },
];

/**
 * The item the given path is inside, and the category holding it.
 *
 * Null for a path the rail does not claim — which is not an error. The gate,
 * the preview frame and the PDF route are all real URLs with no place in a list
 * of places.
 */
export function activeItem(
  pathname: string,
): { categoryId: string; item: NavItem } | null {
  for (const category of NAV) {
    for (const item of category.items) {
      if (item.match(pathname)) return { categoryId: category.id, item };
    }
  }
  return null;
}
