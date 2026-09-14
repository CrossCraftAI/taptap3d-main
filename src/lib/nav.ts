// Which place a URL belongs to.
//
// ── WHY THIS IS NOT INSIDE THE COMPONENT ────────────────────────────────────
//
// It is a pure function of a pathname, so it is testable in node beside the
// engine and the parser rather than only by driving a browser. And it is the
// single place the product's places are written down as something the code can
// be held to: a test walks this list and fails on an item with no page behind
// it, which is the worst thing a navigation can do in front of a customer.
//
// ── A FEATURE LIST, NOT A SEQUENCE ──────────────────────────────────────────
//
// The rail shipped as Record · Capture · Compose · Publish · Move · Connect ·
// Admin, and the owner rejected it, rightly. The first four were a SEQUENCE and
// the last three were capabilities, filed together in one vertical menu. A menu
// throws away the order, and a list of capabilities with four items secretly in
// order misleads. We had built a pipeline and filed it as a menu.
//
// So the rail is a flat list of what is built, in no order that means anything,
// and the SEQUENCE lives where it belongs: as a column of the ledger, derived per
// sale, with a call to action that changes with it (src/lib/workflow.ts). A
// progress bar across the top was considered and rejected; that file says why.
//
// Move, Connect and Admin are gone. They were "not yet" labels whose only job
// was to show a gallery or a museum where the rest of their cycle would go, and
// a feature list is not the place for a roadmap — ROADMAP.md is. Import is gone
// too: the ledger's Next column now says "Import lots" on exactly the sales that
// need it, which is the question the global Import page existed to ask.
//
// Nothing collapses. Four items is not a directory, and at this size the
// remembering machinery — localStorage, an external store, the effect that
// reopened the category you were standing in — was complexity with no payoff.
// It was deleted rather than left switched off, so nobody has to maintain a
// feature nobody can see.

import type { Route } from "next";

/** Which of the rail's two numbers belongs beside an item, if either does. */
export type NavCount = "events" | "photographs";

export interface NavItem {
  href: Route;
  label: string;
  count?: NavCount;
  match: (pathname: string) => boolean;
}

// An event's catalogue is matched HERE rather than collapsing into Events,
// because a person laying out pages is in the catalogues, whichever sale it is.
// Everything else under an event — its lots, its import — is the event.
const EVENT_CATALOGUE = /^\/events\/[^/]+\/catalogue(\/|$)/;

export const NAV: readonly NavItem[] = [
  {
    href: "/",
    label: "Events",
    count: "events",
    match: (p) => p === "/" || (p.startsWith("/events") && !EVENT_CATALOGUE.test(p)),
  },
  {
    href: "/photographs",
    label: "Photographs",
    count: "photographs",
    match: (p) => p.startsWith("/photographs"),
  },
  {
    href: "/catalogues",
    label: "Catalogues",
    match: (p) => p === "/catalogues" || EVENT_CATALOGUE.test(p),
  },
  {
    href: "/exports",
    label: "Exports",
    match: (p) => p.startsWith("/exports"),
  },
];

/**
 * The item the given path is inside.
 *
 * Null for a path the rail does not claim — which is not an error. The gate,
 * an API route and the PDF are all real URLs with no place in a list of places.
 */
export function activeItem(pathname: string): NavItem | null {
  return NAV.find((item) => item.match(pathname)) ?? null;
}
