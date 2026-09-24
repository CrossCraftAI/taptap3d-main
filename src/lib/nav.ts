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

/** Which of the rail's numbers belongs beside an item, if any does. */
export type NavCount = "events" | "photographs" | "lots";

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

// ── WHICH ROWS THE SWITCHER PAINTS, AND WHY THERE ARE TEN OF THEM ───────────
//
// MEASURED FIRST. On a production build with 484 sales in the org, the shell
// painted one anchor per sale into every document: 485 rows, 367,281 bytes on
// the ledger and 292,682 on the editor, inside a panel nobody had opened. One
// painted row is 405 bytes of that and one sale in the flight payload is 119
// (measured by taking the distance between two consecutive rows and between
// two consecutive `lotCount` keys in the served HTML) — so the DOM is 3.4 times
// the payload and it is the term worth cutting.
//
// TEN, AND THE NUMBER IS ARITHMETIC RATHER THAN TASTE. The panel is capped at
// `max-h-[70vh]`; at a 900px-tall window that is 630px. The search box takes
// ~45, the "All events" row and its rule ~37, the foot ~39 and the list's own
// padding 8, leaving ~500px. A row is two lines — `py-1.5` plus 13px and 12px
// of text plus the 2px between them, so ~44px — and 500/44 is eleven. Ten is
// the round number under that, which is the largest list that never needs its
// own scrollbar. Re-measure it by changing those classes, not by preference.
//
// THE CAP IS ON WHAT IS PAINTED, NOT ON WHAT IS FETCHED, and that is forced
// rather than chosen. Capping the data would mean the server picking which
// sales to send, and the server that renders this chrome is the ROOT LAYOUT,
// which cannot know which sale is open: Next's own layout documentation says a
// layout "does not access pathname" because it does not re-render on
// navigation (node_modules/next/dist/docs/01-app/03-api-reference/
// 03-file-conventions/layout.md:240). Three things read the open sale's row out
// of that list — this menu's own label and tick, the palette's PDF row
// (src/lib/palette.ts, `eventId && lots > 0`) and the rail's Lots count — and
// every one of them would be silently wrong for a sale outside the cap. So the
// whole set is sent, the search reads all of it, and only ten are drawn.
//
// What a capped FETCH would cost is written down so the next person does not
// have to rediscover it: a per-event server render (a layout under
// `/events/[id]`, or the chrome moved out of the root layout) or a round trip
// from the browser. Neither is a change to the switcher.

/** The least a row needs in order to be found and drawn. */
export interface Switchable {
  id: string;
  name: string;
  note?: string | null;
}

/** How many rows the panel draws at once. See the arithmetic above. */
export const SWITCHER_ROWS = 10;

export interface SwitcherView<T> {
  /** The rows to draw, in the order they arrived. */
  shown: readonly T[];
  /** How many the query matched, before the cap. */
  matched: number;
  /** How many there are in all, whatever the query. */
  total: number;
}

/**
 * The rows the panel draws for a query.
 *
 * PURE, SO IT IS HELD IN NODE. The thing that goes wrong with a capped list is
 * that the row you are standing on falls off the end of it, and that is a
 * question about an array rather than about a browser.
 *
 * THE OPEN ONE IS NEVER OFF THE LIST — but only while nobody has typed. A
 * search that hands back something it was not asked for is a search nobody can
 * trust, so when there is a query the results are the results and the tick is
 * simply not among them. With no query the open one takes the last slot rather
 * than the first: the list is newest-first, the sale that fell outside the cap
 * is the oldest-touched thing in it, and that is where a reader expects it.
 *
 * Nothing here looks at `currentId` to decide the BUTTON's label. That is read
 * from the whole set by the caller, so the name of the sale you are in never
 * depends on whether its row happened to be drawn.
 */
export function switcherRows<T extends Switchable>(
  items: readonly T[],
  currentId: string | null,
  query: string,
  limit: number = SWITCHER_ROWS,
): SwitcherView<T> {
  const q = query.trim().toLowerCase();
  // The NOTE as well as the name, for the reason src/lib/palette.ts gives
  // about its own search: the note is where the date and the lot count live,
  // and "2026" is a thing somebody types to find a sale.
  const matches = q
    ? items.filter((item) =>
        `${item.name} ${item.note ?? ""}`.toLowerCase().includes(q),
      )
    : items;

  let shown = matches.slice(0, limit);
  if (!q && currentId) {
    const current = items.find((item) => item.id === currentId);
    if (current && !shown.includes(current)) {
      shown = [...shown.slice(0, limit - 1), current];
    }
  }

  return { shown, matched: matches.length, total: items.length };
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
 *
 * LOTS CARRIES ITS COUNT, and the Editor does not. "How big is this sale" is
 * the question a specialist standing in it asks, and the rail already answers
 * the same question for the two things the HOUSE accumulates. It is not a new
 * query: `listEventChoices` already returns a `lotCount` per event for the
 * palette, which drops its PDF row on a sale with nothing in it, so the shell
 * looks the open sale up ONCE and both read the same number.
 *
 * The Editor gets none because a catalogue has no count that is not either the
 * lot count again or a page total nobody has asked for.
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
      count: "lots",
      // The event and everything under it EXCEPT its catalogue and the two
      // registers — its import and its individual lots are the event; the
      // catalogue is the editor above; condition and movement are their own
      // places below. `currentItem` takes the first hit in array order, and
      // Lots is drawn before them, so without these two exclusions it would
      // claim both registers and the rail would mark the wrong row.
      //
      // Rejected: reordering the list so the registers come first. It works
      // and it changes the rail's display order, which is a product decision
      // pinned by test/nav.test.ts — the order is Editor, Lots, and then the
      // places you visit about a lot rather than about the sale.
      match: (p) =>
        p === base ||
        (p.startsWith(`${base}/`) &&
          !p.startsWith(`${base}/catalogue`) &&
          !claims(base, "condition")(p) &&
          !claims(base, "movement")(p)),
    },
    {
      route: "/events/[id]/condition",
      href: `${base}/condition`,
      label: "Condition",
      match: claims(base, "condition"),
    },
    {
      route: "/events/[id]/movement",
      href: `${base}/movement`,
      label: "Movement",
      match: claims(base, "movement"),
    },
  ];
}

/**
 * Each register exists at TWO ALTITUDES, and one matcher has to know both.
 *
 * `/events/{id}/condition` is the sale's register — every lot, and how many
 * have been examined. `/events/{id}/lots/{lotId}/condition` is one lot's own,
 * reached from a row of it. They are the same PLACE in the rail's sense, so
 * the rail marks the same row from either, and a person who has followed a row
 * down into a lot can still read where they are.
 *
 * NO COUNTS ON EITHER, and the reason is measured rather than aesthetic. The
 * rail's numbers come from the root layout (see the note above `NAV`), which
 * cannot know which sale is open — so a per-sale count would have to be two
 * more correlated subqueries for EVERY sale in the org on EVERY request.
 * `listEventChoices` already runs one per event row; on an org of a few
 * hundred sales that is several hundred extra subqueries to print two numbers
 * about one of them. Each register carries its own count on its own meta line,
 * where it costs one query about one sale.
 */
const claims =
  (base: string, tail: "condition" | "movement") =>
  (p: string): boolean =>
    p === `${base}/${tail}` ||
    (p.startsWith(`${base}/lots/`) && p.endsWith(`/${tail}`));

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
