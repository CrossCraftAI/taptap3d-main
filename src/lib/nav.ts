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
// So the rail is a list of what is BUILT, in no order that means anything, and
// the SEQUENCE lives where it belongs: as a column of the ledger, derived per
// sale, with a call to action that changes with it (src/lib/workflow.ts). A
// progress bar across the top was considered and rejected; that file says why.
// That is still true of the grouped rail below — a group is a SUBJECT, never a
// step, and neither group is a stage of anything.
//
// Move, Connect and Admin are gone. They were "not yet" labels whose only job
// was to show a gallery or a museum where the rest of their cycle would go, and
// a feature list is not the place for a roadmap — ROADMAP.md is. Import is gone
// too: the ledger's Next column now says "Import lots" on exactly the sales that
// need it, which is the question the global Import page existed to ask.
//
// ── THE CATEGORIES CAME BACK, AND WHAT CHANGED ──────────────────────────────
//
// This file used to say "nothing INSIDE the rail collapses… four items is not a
// directory… it is not to come back under another name." That reasoning was
// sound for four items about one subject and it is the reason the seven-category
// version was deleted rather than switched off. What changed is not the taste,
// it is the list: the rail now holds SIX places and two of them are about the
// one event you have open while four are about the house. A flat list of six
// mixing two subjects makes a reader check every row to find out which of the
// two it is about — and the two sale-scoped places are the ones a specialist
// uses all day, so they go first and they are named as being about the sale.
//
// The old objection still holds for the old list, and the machinery is
// deliberately NOT the one that was deleted: there is no store and no effect
// that reopens the category you were standing in. A group is a `Collapsible`
// with the same before-paint mechanism the whole rail already uses
// (src/lib/chrome.ts), so the rail has one way of remembering, not two.
//
// IMPORT IS STILL NOT HERE, and that is the same rule as before. Importing is
// something you DO to an event, not a place the event has; it lives in the
// palette's Add panel (src/lib/palette.ts), which is the list of things you can
// make. Places in the rail, actions in the palette.
//
// The rail AS A WHOLE can be put away — one control, one shortcut, remembered
// per viewer — because what a specialist laying out pages wants is not a
// smaller menu but the window. src/lib/chrome.ts holds the measurement and the
// mechanism; `isEditor` below is how the shell knows to start that way.

/** Which of the rail's two numbers belongs beside an item, if either does. */
export type NavCount = "events" | "photographs";

export interface NavItem {
  /**
   * Next's own route pattern — "/events/[id]/catalogue", not the filled-in
   * path. It is what test/nav.test.ts looks for on disk, and that filesystem
   * check is a stronger guard than `typedRoutes` can give: a path assembled at
   * runtime is a `string` to the compiler whatever we annotate it.
   */
  route: string;
  /** That pattern with the open event filled in. What the link points at. */
  href: string;
  label: string;
  count?: NavCount;
  match: (pathname: string) => boolean;
}

export interface NavGroup {
  key: "sale" | "house";
  label: string;
  items: readonly NavItem[];
}

// An event's catalogue is matched HERE rather than collapsing into Events,
// because a person laying out pages is in the catalogues, whichever sale it is.
// Everything else under an event — its lots, its import — is the event.
const EVENT_CATALOGUE = /^\/events\/[^/]+\/catalogue(\/|$)/;

/** `/events/{id}/…` → the id, for every path that is inside one event. */
const EVENT = /^\/events\/([^/]+)(?:\/|$)/;

/**
 * Whether a path is the editor — the one screen where the canvas takes the
 * window by default and the rail waits to be asked for.
 */
export function isEditor(pathname: string): boolean {
  return EVENT_CATALOGUE.test(pathname);
}

/**
 * Which event a path is inside, or null.
 *
 * THE URL IS THE ONLY ANSWER TO "WHICH SALE IS OPEN". Rejected: remembering the
 * last event a viewer opened, in storage, so the sale-scoped chrome survives a
 * trip to the library. It is one line and it reintroduces the exact failure the
 * switcher exists to prevent — a chrome that names a sale the screen is not
 * about. Off an event's own screens there is no open sale, the switcher says
 * so, and the sale-scoped group is simply not there.
 */
export function openEventId(pathname: string): string | null {
  return EVENT.exec(pathname)?.[1] ?? null;
}

/**
 * Where the switcher lands when a viewer picks a different event.
 *
 * THE SAME SCREEN, THE OTHER SALE — but only where that sentence is true.
 * Carrying the tail of the path across a switch is what makes the control feel
 * like a switch rather than a link home, and on the editor, which is the
 * screen it exists for, it is exactly right. It is wrong the moment the tail
 * names something the other event does not own: `/events/a/lots/xyz` mapped to
 * `/events/b/lots/xyz` is a 404 built by hand, because a lot belongs to one
 * event. So the tails that survive are an explicit two, and everything else
 * lands on the event itself.
 *
 * `/import` is deliberately not one of them. A half-finished import is a task
 * in progress, and arriving at another sale's import wizard is a surprise
 * rather than a switch.
 */
export function switchEvent(pathname: string, toEventId: string): string {
  const from = openEventId(pathname);
  const to = `/events/${toEventId}`;
  if (!from) return to;
  const tail = pathname.slice(`/events/${from}`.length);
  return tail === "/catalogue" ? `${to}/catalogue` : to;
}

/** The house's places: what is built, for the whole organisation. */
export const NAV: readonly NavItem[] = [
  {
    route: "/",
    href: "/",
    label: "Events",
    count: "events",
    // EVERYTHING UNDER /events, THE CATALOGUE INCLUDED. This used to exclude
    // the editor, because `/catalogues` claimed it — one ledger later there is
    // no such place, and leaving the exclusion in marks no row at all while a
    // person is in the editor, which is the one screen where "where am I" is
    // hardest to answer from the content. `currentItem()` still resolves the
    // overlap in favour of the innermost claim, so inside an event the sale's
    // own Editor row is marked and this one is not.
    match: (p) => p === "/" || p.startsWith("/events"),
  },
  {
    route: "/photographs",
    href: "/photographs",
    label: "Photographs",
    count: "photographs",
    match: (p) => p.startsWith("/photographs"),
  },
  // `/catalogues` and `/exports` were here and are gone. They were one
  // component — `EventChooser` — over the same rows with a different verb, and
  // the landing page was the same columns again with a quick-add line on top.
  // Three doors into one table is three places to keep in step and two answers
  // to "where do I find a sale". The ledger at `/` is the one door; the verb
  // that used to be the screen's name is now the row's own next action, which
  // is where this file argued it belonged before either screen existed.
];

/**
 * The places that exist only while one event is open.
 *
 * Both are pages that already shipped; what is new is that they are reachable
 * without going back to the ledger and finding the row again. The editor is
 * first because it is where the day is spent.
 */
export function saleNav(eventId: string): readonly NavItem[] {
  const base = `/events/${eventId}`;
  return [
    {
      route: "/events/[id]/catalogue",
      href: `${base}/catalogue`,
      label: "Editor",
      match: (p) => p === `${base}/catalogue` || p.startsWith(`${base}/catalogue/`),
    },
    {
      route: "/events/[id]",
      href: base,
      label: "Lots",
      // The event and everything under it EXCEPT its catalogue — its import and
      // its individual lots are the event; the catalogue is the editor above.
      match: (p) =>
        p === base ||
        (p.startsWith(`${base}/`) && !p.startsWith(`${base}/catalogue`)),
    },
  ];
}

/** The rail, as the groups it draws. The sale's own places come first. */
export function navGroups(eventId: string | null): readonly NavGroup[] {
  const house: NavGroup = { key: "house", label: "The house", items: NAV };
  if (!eventId) return [house];
  return [
    { key: "sale", label: "This event", items: saleNav(eventId) },
    house,
  ];
}

/**
 * The item the given path is inside.
 *
 * Null for a path the rail does not claim — which is not an error. The gate,
 * an API route and the PDF are all real URLs with no place in a list of places.
 */
export function activeItem(pathname: string): NavItem | null {
  return NAV.find((item) => item.match(pathname)) ?? null;
}

/**
 * The ONE item the rail marks, across every group.
 *
 * Two rows marked at once is not a cosmetic bug: the rail's only job is to say
 * where you are, and an editor path legitimately matches both the sale's
 * "Editor" and the house's "Catalogues". The innermost claim wins — the sale's
 * group is searched first — so the mark is always the most specific true thing
 * and there is always exactly one of it.
 */
export function currentItem(
  groups: readonly NavGroup[],
  pathname: string,
): NavItem | null {
  for (const group of groups) {
    const hit = group.items.find((item) => item.match(pathname));
    if (hit) return hit;
  }
  return null;
}
