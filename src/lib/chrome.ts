// The chrome a viewer can put away — the top bar, the rail and its groups, the
// palette, the editor's lots panel — and how each choice is kept.
//
// ── THE WHOLE RAIL FIRST, ITS CATEGORIES SECOND ─────────────────────────────
//
// What a specialist laying out pages needs is not a smaller menu but THE
// WINDOW. Measured on production in a 1440×900 window, the A4 page — the
// entire point of the product — had 450×637 of it, 22.1%; a rail, a header, a
// controls bar and a lots panel had the other 78%. So one control puts the
// entire navigation away, and the editor arrives with it away. Every screen
// can take the window; the editor does so by default. test/e2e/editor.spec.ts
// holds the number.
//
// The per-category collapse was deleted once, with the seven categories, and
// it is back for a list that earns it — src/lib/nav.ts says what changed. It
// is back as ANOTHER `Collapsible`, not as the store-and-effect machinery that
// was deleted: one mechanism, one shape, one place to read.
//
// ── REMEMBERED IN THE BROWSER, NEVER ON A REQUEST ───────────────────────────
//
// localStorage, per viewer. Not a cookie: a per-viewer convenience has no
// consequence for anyone else and no business on a request header, and a root
// layout that read one would make every page wait on it. Every read and every
// write is wrapped — a private window THROWS on access rather than answering
// nothing — because a rail that cannot render is worse than one that forgets.
//
// One key per part. The stored value is a CHOICE — "open" or "closed" — or
// absent, and absent means the route's default: closed in the editor, open
// everywhere else. So a viewer who has never touched the control gets the
// editor's canvas and the ledger's rail, and one who has gets what they chose,
// wherever they are. Rejected: a key per route, which remembers a choice in
// one place and forgets it in the next, and which a person experiences as a
// rail with a mind of its own.
//
// ── APPLIED BEFORE FIRST PAINT ──────────────────────────────────────────────
//
// The server cannot read the viewer's storage, so it renders the route's
// default; left there, a viewer who put the rail away would watch it flash in
// and out on every hard load. Next's own guide on this (node_modules/next/
// dist/docs/01-app/02-guides/preventing-flash-before-hydration.md) is
// followed to the letter: an inline script placed right after the element
// applies the stored choice WHILE THE HTML IS STILL BEING PARSED, and the
// component's lazy useState initialiser reads the same key, so React's first
// client render agrees with the DOM the script left and hydration has nothing
// to repair. On a client-side navigation the script is inert and the
// initialiser alone is enough.
//
// Rejected: useSyncExternalStore — its server snapshot is what hydration
// renders, which is exactly the value the script has already corrected away
// from, so it warns and re-renders. Rejected: an effect — it runs after paint,
// which IS the flash. Rejected: a data attribute on <html> with a stylesheet
// rule — it needs suppressHydrationWarning on the document element and states
// the same rule in two languages.

// ── THE RAIL HAS THREE STATES AND TWO CONTROLS ──────────────────────────────
//
// away · icons · full. The middle one is new and it is the mode a specialist
// laying out pages is meant to live in: the places stay reachable and the work
// gets back the difference between the two widths, which is re-measurable by
// reading `RAIL_WIDE` and `RAIL_ICONS` below.
//
// THREE STATES, AND DELIBERATELY NOT ONE CONTROL THAT CYCLES THEM. The obvious
// build is Ctrl+\ walking full → icons → away → full, and it was rejected,
// because the two questions it would answer are not one axis:
//
//   "Is the navigation here?" is MOMENTARY. A person wants the window for this
//   one task and wants it back afterwards; that is what the shortcut is
//   borrowed from Figma to mean, and it is why the editor starts away.
//
//   "How wide is it when it is here?" is a STANDING PREFERENCE. It is set once
//   by somebody deciding how they work, and it is not touched again.
//
// Put both on one control and every momentary gesture overwrites the standing
// preference: a person who lives in the icon rail presses the shortcut to get
// the window, presses it again, and is handed the full rail — which is the
// "rail with a mind of its own" this file already refuses further down. Worse,
// from `full` the window would then be TWO presses away, and one press is the
// whole promise of the chord.
//
// So there are two controls and two keys, and the pair has four combinations
// where the product has three states. The fourth is not a fourth state: `away`
// looks identical whichever width is stored, and that stored width is exactly
// the memory that lets the rail come back the way the viewer works.
//
// Rejected as well: a second chord for the width. A key is spent on a gesture
// that is repeated, and this one is pressed when somebody changes their mind
// about how they work — which is not a thing that happens twice in a day.

import { isEditor } from "@/lib/nav";

export type Choice = "open" | "closed";

/**
 * A part of the chrome that can be put away: its storage key, and the ids the
 * before-paint script and the driven tests reach it by.
 */
export interface Collapsible {
  key: string;
  /** The element that hides. */
  id: string;
  /** The button that says so, with aria-expanded. */
  toggle: string;
}

export const RAIL: Collapsible = {
  key: "taptap3d.rail",
  id: "rail",
  toggle: "rail-toggle",
};

/** Which of the rail's two widths is showing. `full` is the labelled rail. */
export type Width = "full" | "icons";

/**
 * The rail's width: the SAME element as `RAIL`, a second decision, a second
 * key. The header of this file argues why it is not the same control.
 *
 * NOT A `Collapsible`, and the difference is the whole reason it is its own
 * shape. A collapsible part answers "is this element on the page" and the
 * before-paint script answers it with `hidden`, which is total — the element
 * is there or it is not. A width is a value the element carries, so the script
 * writes `data-rail` and the stylesheet keys off it. Forcing this through
 * `Collapsible` would mean an `open` that means narrow, which is the kind of
 * name that is wrong in every sentence somebody writes about it afterwards.
 */
export interface Widthable {
  key: string;
  /** The element that narrows. `RAIL.id`, because there is one rail. */
  id: string;
  /** The button that says so, with aria-pressed. */
  toggle: string;
}

export const RAIL_WIDTH: Widthable = {
  key: "taptap3d.rail.width",
  id: RAIL.id,
  toggle: "rail-width",
};

/**
 * The two widths, in pixels, as the classes that paint them.
 *
 * Written here rather than only in the component so the driven test can hold
 * the numbers without reaching into a className, and so the arithmetic above
 * ("the work gets back the difference") is re-measurable from one place.
 *
 * 44 IS NOT THE DRAWING'S 46, and the two pixels were given up on purpose.
 * The shell already paints one icon column — the palette's spine, `w-11` in
 * src/components/palette.tsx — and the palette's body is shut by default, so
 * the icon rail and that spine sit against one another with a hairline
 * between. Two icon columns two pixels apart read as a mistake rather than as
 * a design. 44 is also `--tap` under a coarse pointer (src/app/globals.css):
 * the rail's rows are the one place where the control IS the column, so on a
 * tablet the column's width is the control's width and the floor is 44. Two
 * reasons, one number, both re-measurable.
 */
export const RAIL_WIDE = 224;
export const RAIL_ICONS = 44;

/** A stored value — anything storage can hold — resolved to a width. */
export function widthOf(stored: unknown, fallback: Width): Width {
  if (stored === "icons") return "icons";
  if (stored === "full") return "full";
  return fallback;
}

/**
 * Where the rail's width starts when the viewer has not said.
 *
 * ONE ANSWER, THE SAME ON EVERY SCREEN — no `railDefault` twin keyed to the
 * path. Whether the rail is THERE is a per-route default because the editor's
 * page area is measured and the argument is arithmetic; how wide it is when a
 * person has asked for it is a preference, and a preference that changes
 * screen to screen is the rail with a mind of its own that this file refuses
 * one paragraph below.
 */
export const WIDTH_DEFAULT: Width = "full";

/**
 * The script that applies a stored width before first paint.
 *
 * The twin of `applyBeforePaint`, and it is a twin rather than a parameter
 * because what it writes is a VALUE and not a presence: `data-rail` on the
 * rail, which the component's own classes key off (`data-[rail=icons]:…`), and
 * `aria-pressed` on the toggle, which is what a two-state button says about
 * itself. Both are exactly what the component renders from the same key, and
 * test/chrome.test.ts runs this string against `widthOf` for every kind of
 * value storage can hold, so the two cannot drift.
 */
export function applyWidthBeforePaint(part: Widthable, fallback: Width): string {
  const key = JSON.stringify(part.key);
  const id = JSON.stringify(part.id);
  const toggle = JSON.stringify(part.toggle);
  return (
    `(function(){var v=null;try{v=localStorage.getItem(${key})}catch(e){}` +
    `var w=v==="icons"?"icons":v==="full"?"full":${JSON.stringify(fallback)};` +
    `var el=document.getElementById(${id});` +
    `if(el)el.setAttribute("data-rail",w);` +
    `var b=document.getElementById(${toggle});` +
    `if(b)b.setAttribute("aria-pressed",w==="icons"?"true":"false")})()`
  );
}

/**
 * The top bar: the SAME choice as the rail, a second element.
 *
 * The toggle is labelled "Navigation" and the top bar holds navigation — the
 * event switcher and the house's name. Putting half the navigation away and
 * leaving the other half on screen is not a state anyone asked for, so the two
 * hide together and there is one control, not two.
 *
 * It also has to be this way on the editor, and that half is arithmetic rather
 * than preference. At fit-page the preview sizes the page by HEIGHT — `height:
 * calc(100vh - 32px)` in src/lib/render/html.ts — and the page is A4, so its
 * AREA falls with the square of whatever a bar takes off the top, while the
 * editor's own header already spends two rows of the window.
 * test/e2e/editor.spec.ts measures that area as a share of the window and
 * holds a floor under it; put those two together and the headroom between the
 * share the editor has today and the floor it must keep is a fraction of the
 * height a wordmark, a house name and a switcher need. So on the editor the
 * whole navigation starts away — as the rail already did — and one keystroke
 * brings it back. The mockup's "the one strip that never collapses" does not
 * survive that sum. It is a sum and not a reading: driving the editor with the
 * bar forced on is what would turn it into one.
 *
 * A separate key was rejected: two keys is two things to get out of step, and
 * a viewer who hid "the navigation" and got a top bar back on the next page
 * would rightly call it a bug.
 */
export const TOP_BAR: Collapsible = {
  key: "taptap3d.rail",
  id: "topbar",
  toggle: "rail-toggle",
};

/**
 * The rail's two groups. Separate keys, because they are separate decisions:
 * a person who never leaves one event shuts the house group and keeps it shut.
 */
export const NAV_SALE: Collapsible = {
  key: "taptap3d.nav.sale",
  id: "nav-sale",
  toggle: "nav-sale-toggle",
};

export const NAV_HOUSE: Collapsible = {
  key: "taptap3d.nav.house",
  id: "nav-house",
  toggle: "nav-house-toggle",
};

/**
 * The palette's body. The SPINE never hides — it is how the body comes back —
 * so only the 300px body carries this.
 *
 * Shut by default, everywhere. The mockup opens it on its two canvases; the
 * one canvas that exists here is height-bound, so an open panel costs the page
 * nothing and would still be a panel nobody asked for sitting over the work on
 * every load. Which panel is open is not remembered, only whether one is: the
 * spine has two buttons and re-picking is one click, where a remembered panel
 * key is a second thing to keep valid as panels come and go by route.
 */
export const PALETTE: Collapsible = {
  key: "taptap3d.palette",
  id: "palette-body",
  // Replaced per render with the first panel's spine button: which button
  // carries `aria-expanded` depends on which panels the route has.
  toggle: "palette-pick",
};

export const LOTS_PANEL: Collapsible = {
  key: "taptap3d.lots-panel",
  id: "lots-panel",
  toggle: "lots-panel-toggle",
};

/** Whether the rail is open on this path when the viewer has not said. */
export function railDefault(pathname: string): boolean {
  return !isEditor(pathname);
}

/** A stored value — anything storage can hold — resolved to open or not. */
export function isOpen(stored: unknown, fallback: boolean): boolean {
  if (stored === "open") return true;
  if (stored === "closed") return false;
  return fallback;
}

export function readChoice(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * Every word the chrome writes into storage.
 *
 * ONE WRITER FOR BOTH VOCABULARIES, because there is one storage and one
 * try/catch worth having. The two sets do not overlap — open/closed is a
 * presence and full/icons is a width — and keeping them distinct is what
 * makes a value found on the wrong key readable as nonsense rather than as an
 * answer: `widthOf` refuses "open" and `isOpen` refuses "icons", each falling
 * back to its own default.
 */
export type Stored = Choice | Width;

export function writeChoice(key: string, choice: Stored): void {
  try {
    window.localStorage.setItem(key, choice);
  } catch {
    // Said above: the part then forgets, and still renders.
  }
}

/**
 * The script that applies a stored choice before first paint.
 *
 * Plain ES5 in one expression. `fallback` is a literal because the SERVER knows
 * the path it is rendering and bakes the route's default in, so the script
 * carries no copy of the route rule. Everything it touches — `hidden` on the
 * element, `aria-expanded` on the toggle — is exactly what the component
 * renders from the same key; test/chrome.test.ts runs this string against
 * `isOpen` for every kind of value storage can hold, so the two cannot drift.
 */
export function applyBeforePaint(part: Collapsible, fallback: boolean): string {
  const key = JSON.stringify(part.key);
  const id = JSON.stringify(part.id);
  const toggle = JSON.stringify(part.toggle);
  return (
    `(function(){var v=null;try{v=localStorage.getItem(${key})}catch(e){}` +
    `var o=v==="open"?true:v==="closed"?false:${fallback ? "true" : "false"};` +
    `var el=document.getElementById(${id});` +
    `if(el){if(o)el.removeAttribute("hidden");else el.setAttribute("hidden","")}` +
    `var b=document.getElementById(${toggle});` +
    `if(b)b.setAttribute("aria-expanded",o?"true":"false")})()`
  );
}
