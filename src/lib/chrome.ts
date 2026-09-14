// The chrome a viewer can put away — the rail, the editor's lots panel — and
// how the choice is kept.
//
// ── THE WHOLE RAIL, NOT ITS CATEGORIES ──────────────────────────────────────
//
// The per-category collapse was deleted with the categories (src/lib/nav.ts)
// and it stays deleted: four items do not need a filing system. What a
// specialist laying out pages needs is not a smaller menu but THE WINDOW.
// Measured on production in a 1440×900 window, the A4 page — the entire point
// of the product — had 450×637 of it, 22.1%; a rail, a header, a controls bar
// and a lots panel had the other 78%. So one control puts the entire rail
// away, and the editor arrives with it away. Every screen can take the window;
// the editor does so by default. test/e2e/editor.spec.ts holds the number.
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

export function writeChoice(key: string, choice: Choice): void {
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
