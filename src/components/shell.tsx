"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";

import { InlineScript } from "@/components/inline-script";
import { Nav } from "@/components/nav";
import { Palette } from "@/components/palette";
import { TopBar } from "@/components/top-bar";
import { useCollapsible } from "@/components/use-collapsible";
import { RAIL, TOP_BAR, applyBeforePaint, railDefault } from "@/lib/chrome";
import type { EventChoice } from "@/lib/data/events";
import { isTyping } from "@/lib/keys";
import { openEventId } from "@/lib/nav";
import { paletteFor } from "@/lib/palette";

/**
 * The shell: a top bar, a rail, a palette, and the work.
 *
 * ── ONE BUTTON, ONE PLACE, ONE ELEMENT ───────────────────────────────────────
 *
 * The toggle sits in the top-left corner of the window whether the navigation
 * is open or not, and it is the SAME element either way. Two buttons — one
 * inside the rail, one over the content — is the obvious build, and it loses
 * the keyboard: the button a person just pressed disappears with the rail and
 * focus falls to the document body. One fixed element keeps focus where the
 * finger is. Focus that was inside the rail when it closed — a person tabbing
 * the links, then pressing the shortcut — is moved to the toggle rather than
 * lost into a hidden subtree.
 *
 * It stays FIXED rather than moving into the top bar when the top bar is
 * showing, for that same reason: a control that changes DOM position between
 * two states is two controls as far as focus is concerned. The top bar and the
 * palette's spine each leave room for it instead.
 *
 * `hidden`, not conditional rendering: the parts keep their DOM, the attribute
 * takes them out of the accessibility tree and the tab order together, and the
 * before-paint script (src/lib/chrome.ts) has elements to set it on. Tailwind's
 * preflight writes `[hidden] { display: none !important }`, so the attribute
 * beats any layout utility on the same element and a part cannot be left
 * visible by a class — which is what makes it safe for a script that knows
 * only the id to be the thing that decides.
 *
 * ── THE TOP BAR GOES WITH THE RAIL ───────────────────────────────────────────
 *
 * Both are navigation and both answer to the one control, on the one stored
 * choice. src/lib/chrome.ts `TOP_BAR` holds the measurement that makes this
 * the only shippable arrangement on the editor: the preview sizes the page by
 * height, so a bar across the top costs the page area squared, and the
 * editor's floor is held in test/e2e/editor.spec.ts. On the editor the whole
 * navigation therefore starts away — as the rail already did — and the
 * editor's own header goes on naming the sale it is showing.
 *
 * ── THE SHORTCUT ─────────────────────────────────────────────────────────────
 *
 * Ctrl+\ (⌘\ on a Mac): Figma's key for hiding its UI, which is the product
 * this behaviour is borrowed from, and unbound in every browser that matters.
 * Rejected: Ctrl+B, which is VS Code's and opens the bookmarks sidebar in
 * Firefox. Rejected: a bare key such as `[`, which is a character somebody
 * types. The chord is ignored while focus is in a field of any kind, so
 * nothing a person types into a form is ever read as a command; that guard is
 * shared with the lot stepper's arrows and lives in src/lib/keys.ts.
 *
 * ── THE WINDOW IS THE FRAME, AND THE WORK SCROLLS INSIDE IT ─────────────────
 *
 * The shell is one viewport tall and does not scroll; `main` does. The
 * document used to scroll, which works until something is pinned above it: a
 * top bar in that flow either scrolls away — and then the strip that is
 * supposed to be on every screen is not — or is `sticky`, and the editor,
 * which is exactly one viewport tall, becomes one viewport plus a bar and
 * grows a scrollbar with the bottom of the page under it. Next's router
 * handles an inner scroller (it scrolls the document to the top and then
 * `scrollIntoView`s the new segment), so navigation still lands at the top of
 * the page.
 */
export function Shell({
  org,
  events,
  counts,
  children,
}: {
  org: string | null;
  events: readonly EventChoice[];
  counts: { events: number; photographs: number; unassigned: number };
  children: React.ReactNode;
}): React.ReactElement {
  const pathname = usePathname();
  const fallback = railDefault(pathname);
  const [open, setStoredOpen] = useCollapsible(RAIL, fallback, "shell.rail");

  const rail = useRef<HTMLElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);

  const setOpen = useCallback(
    (next: boolean): void => {
      setStoredOpen(next);
      if (!next && rail.current?.contains(document.activeElement)) {
        toggle.current?.focus();
      }
    },
    [setStoredOpen],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "\\" || !(event.ctrlKey || event.metaKey)) return;
      if (event.altKey || event.shiftKey || event.repeat || event.defaultPrevented) return;
      if (isTyping(event.target)) return;
      event.preventDefault();
      setOpen(!open);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, setOpen]);

  const eventId = openEventId(pathname);
  const panels = paletteFor({
    pathname,
    eventId,
    lots: events.find((event) => event.id === eventId)?.lotCount ?? 0,
  });

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      {/* Fixed in the corner, above everything, on every screen. Hidden below
          md together with the rail it controls, which never showed there. */}
      <button
        id={RAIL.toggle}
        ref={toggle}
        type="button"
        aria-controls={`${RAIL.id} ${TOP_BAR.id}`}
        aria-expanded={open}
        aria-label="Navigation"
        title={`${open ? "Hide" : "Show"} the navigation (Ctrl+\\ or ⌘\\)`}
        // FOCUS IS TAKEN, not assumed. Clicking a <button> does not focus it in
        // WebKit — macOS convention, and the same is true of Firefox there — so
        // the promise made above, that this control is the one way back and
        // therefore keeps focus, was false in Safari and true everywhere the
        // suite looked. Found by the webkit project the moment it existed; a
        // no-op in Chromium, which has already done it.
        onClick={() => {
          toggle.current?.focus();
          setOpen(!open);
        }}
        className="fixed left-1.5 top-1.5 z-50 hidden h-[26px] w-[26px] items-center justify-center border border-rule bg-paper text-muted hover:text-ink md:flex"
      >
        <RailGlyph open={open} />
      </button>

      <header id={TOP_BAR.id} hidden={!open} className="shrink-0">
        <TopBar org={org} events={events} />
      </header>
      <InlineScript html={applyBeforePaint(TOP_BAR, fallback)} />

      <div className="flex min-h-0 flex-1">
        {/* THE RAIL IS PRESENT INSIDE THE EDITOR TOO, when it is present at
            all. The predecessor made its editor a separate world reached by a
            link, so an event was somewhere you escaped from rather than
            somewhere you were. Putting the rail away is the viewer's choice and
            one keystroke undoes it; a separate world has no way back. */}
        <aside
          id={RAIL.id}
          ref={rail}
          hidden={!open}
          className="w-56 shrink-0 overflow-y-auto border-r border-rule bg-paper max-md:hidden"
        >
          <div className="flex min-h-full flex-col py-2">
            <Nav counts={counts} />
            <p className="mt-auto px-3 pt-4 text-[11px] leading-relaxed text-faint">
              M1 — the pitch. Catalogue production; no money path.
            </p>
          </div>
        </aside>
        <InlineScript html={applyBeforePaint(RAIL, fallback)} />

        <Palette panels={panels} clearCorner={!open} />

        {/* A COLUMN, so a page that wants the whole box can say `flex-1` and
            get it. Percentage heights against a stretched flex item do resolve
            in every engine that matters, but the failure mode if one ever did
            not is an editor whose canvas is nought pixels tall and completely
            invisible — and the canvas is an absolutely positioned frame, so
            there would be nothing on screen to suggest what went wrong. A
            column costs nothing and cannot fail that way. */}
        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}

/** A window with a rail down its left side; the rail filled while it shows. */
function RailGlyph({ open }: { open: boolean }): React.ReactElement {
  return (
    <svg
      aria-hidden="true"
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
    >
      <rect x="1" y="2" width="12" height="10" />
      <line x1="5" y1="2" x2="5" y2="12" />
      {open && <rect x="1" y="2" width="4" height="10" fill="currentColor" stroke="none" />}
    </svg>
  );
}
