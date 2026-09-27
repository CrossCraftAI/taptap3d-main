"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { InlineScript } from "@/components/inline-script";
import { Nav, type NavCounts } from "@/components/nav";
import { Palette } from "@/components/palette";
import { TopBar } from "@/components/top-bar";
import { useCollapsible } from "@/components/use-collapsible";
import {
  RAIL,
  RAIL_WIDTH,
  TOP_BAR,
  WIDTH_DEFAULT,
  applyBeforePaint,
  applyWidthBeforePaint,
  railDefault,
  readChoice,
  widthOf,
  writeChoice,
  type Width,
} from "@/lib/chrome";
import type { EventChoice } from "@/lib/data/events";
import { isTyping } from "@/lib/keys";
import { logAction } from "@/lib/log/client";
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
 * IT STILL HAS TWO STATES NOW THAT THE RAIL HAS THREE. The chord and the
 * corner button answer "is the navigation here"; the rail's own foot answers
 * "how wide is it when it is". src/lib/chrome.ts argues that at length — in
 * one line, a momentary gesture must not overwrite a standing preference, so
 * putting the navigation away and bringing it back returns the width the
 * viewer works in rather than the one the product would like them to have.
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
  /** The house's numbers. The open sale's own is looked up here, below. */
  counts: Omit<NavCounts, "lots">;
  children: React.ReactNode;
}): React.ReactElement {
  const pathname = usePathname();
  const fallback = railDefault(pathname);
  const [open, setStoredOpen] = useCollapsible(RAIL, fallback, "shell.rail");
  const [width, setWidth] = useRailWidth();

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
  // ONE LOOKUP, TWO READERS. The palette drops its PDF row on a sale with
  // nothing in it and the rail says how big the sale is; both are the same
  // number out of the same row, so they are found once and cannot disagree.
  //
  // The two DEFAULTS differ on purpose. The palette asks "is there anything to
  // print", and not knowing is as good as nought there. The rail PRINTS the
  // number, so not knowing has to stay null — a rail that says 0 for a sale
  // the shell could not find is a number that means something else.
  const openSale = eventId
    ? (events.find((event) => event.id === eventId) ?? null)
    : null;
  const panels = paletteFor({
    pathname,
    eventId,
    lots: openSale?.lotCount ?? 0,
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
        className="group fixed left-1.5 top-1.5 z-50 hidden h-[26px] w-[26px] items-center justify-center border border-rule bg-paper text-muted hover:text-ink md:flex"
      >
        <RailGlyph />
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
        {/* `group` AND `data-rail`, WHICH IS HOW THE ICON RAIL SURVIVES THE
            FIRST PAINT. The width is a stored per-viewer choice, so the server
            renders the default and a script corrects it before anything is
            painted — and a width cannot be corrected by the `hidden` attribute
            the other parts use, because it is a value rather than a presence.
            So the script writes `data-rail` here and every class that differs
            between the two widths is a `data-[rail=icons]:` or a
            `group-data-[rail=icons]:` variant of it. Nothing below reads the
            width from React except where an ATTRIBUTE has to change, which CSS
            cannot do. src/lib/chrome.ts holds the mechanism. */}
        <aside
          id={RAIL.id}
          ref={rail}
          hidden={!open}
          data-rail={width}
          className="group w-56 shrink-0 overflow-y-auto border-r border-rule bg-paper too-small:hidden data-[rail=icons]:w-11 data-[rail=icons]:overflow-x-hidden"
        >
          <div className="flex min-h-full flex-col py-2">
            <Nav counts={{ ...counts, lots: openSale?.lotCount ?? null }} />
            <div className="mt-auto pt-4">
              <WidthToggle width={width} onPick={setWidth} />
              {/* GONE at the narrow width, not `sr-only`. Prose does not fit
                  in 44 pixels, and this is a standing caption about the build
                  rather than the name of anything — every label that IS a
                  name stays in the document when it stops being drawn, and
                  the difference between the two is what `hidden` says here
                  and `sr-only` says in the rows. */}
              <p className="px-3 pt-2 text-[12px] leading-relaxed text-faint group-data-[rail=icons]:hidden">
                M1 — the pitch. Catalogue production; no money path.
              </p>
            </div>
          </div>
        </aside>
        <InlineScript html={applyBeforePaint(RAIL, fallback)} />
        <InlineScript html={applyWidthBeforePaint(RAIL_WIDTH, WIDTH_DEFAULT)} />

        <Palette panels={panels} clearCorner={!open} />

        {/* A COLUMN, so a page that wants the whole box can say `flex-1` and
            get it. Percentage heights against a stretched flex item do resolve
            in every engine that matters, but the failure mode if one ever did
            not is an editor whose canvas is nought pixels tall and completely
            invisible — and the canvas is an absolutely positioned frame, so
            there would be nothing on screen to suggest what went wrong. A
            column costs nothing and cannot fail that way. */}
        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto too-small:hidden">
          {children}
        </main>

        {/* ── TOO SMALL A WINDOW SAYS SO, RATHER THAN TRYING ───────────────
            The owner's decision: a tablet at a viewing is plausible, a handset
            cataloguing a sale is not. What was shipping below `md` was not a
            smaller version of this product, it was a broken one — the rail and
            the palette were already hidden, so there was no navigation at all;
            the ledger's Next column, which is the entire point of that screen,
            sat off the right edge; and on the editor the lots panel is a rigid
            340px, so the document itself measured 0px at 320 and 50px at 390.
            Three screens' worth of clipping, none of which a person could act
            on.

            A sentence is more honest than any of that. It is not an apology
            and it does not promise a phone version — it says what the window
            needs, which is the one thing the reader can change. When a phone
            form is designed, this is the thing that is deleted, and it is
            findable because it is the only `too-small:flex` block in the
            shell.

            THE CONDITION IS BOTH AXES, and it did not used to be. `md` is a
            width, and a phone held landscape is 844×390 — so it passed a test
            written to exclude it and got the whole product in 390 pixels of
            height, with the sale's titles cut to one character each. The
            variant is defined once in src/app/globals.css and says why. */}
        <div className="hidden flex-1 items-center justify-center px-6 too-small:flex">
          <p className="max-w-xs text-center text-[13px] leading-relaxed text-muted">
            taptap3d needs a window at least 768 pixels wide and 500 tall. A
            tablet either way up is enough; a phone is not, in either hand, and
            a catalogue laid out on one would be a catalogue nobody could read.
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * A window with a rail down its left side; the rail filled while it shows.
 *
 * DRAWN FROM `aria-expanded`, NOT FROM REACT. This took a prop and rendered
 * the fill conditionally, which is right after hydration and wrong before it:
 * the server renders the ROUTE's default while the script has already applied
 * the VIEWER's stored choice, so a person who keeps the navigation away saw a
 * filled glyph over a hidden rail until the bundle landed. The same attribute
 * the script already corrects is what decides the fill here, so there is one
 * source of truth and no window in which the button lies about its own state.
 * The two paths are the same `hidden`/`block` pair the width toggle below
 * uses, for the same reason.
 */
function RailGlyph(): React.ReactElement {
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
      <rect
        x="1"
        y="2"
        width="4"
        height="10"
        fill="currentColor"
        stroke="none"
        className="hidden group-aria-expanded:block"
      />
    </svg>
  );
}

/**
 * How wide the rail is when it is here — the second of the rail's two
 * controls, argued in src/lib/chrome.ts.
 *
 * AT THE FOOT, NOT IN THE CORNER. The corner is taken, and it is taken by the
 * control that has to be reachable when the rail is gone. This one only means
 * anything while the rail is on screen, so it lives inside the rail and goes
 * away with it — which is also what keeps the corner a single element for
 * focus, the promise the header of this file makes.
 *
 * A PRESSED BUTTON, NOT A DISCLOSURE. `aria-expanded` would be a claim that
 * this shows and hides a region, and it does not: every place stays on the
 * page and reachable at both widths. `aria-pressed` is the word for a control
 * that is on or off, and the before-paint script writes it.
 *
 * THE LABEL DOES NOT CHANGE WITH THE STATE, which is deliberate rather than
 * lazy. A toggle whose name changes ("Icons only" / "Show labels") is two
 * names for one control — it re-announces on every press, and it is the one
 * thing here that could not be corrected before paint, because a script can
 * fix an attribute and cannot fix a word React rendered. One constant name,
 * one `aria-pressed`, and the chevrons below say the same thing to an eye.
 */
function WidthToggle({
  width,
  onPick,
}: {
  width: Width;
  onPick: (next: Width) => void;
}): React.ReactElement {
  return (
    <button
      id={RAIL_WIDTH.toggle}
      type="button"
      aria-controls={RAIL.id}
      // Rendered from the default on the server and corrected before paint by
      // `applyWidthBeforePaint`; the lazy initialiser in `useRailWidth` reads
      // the same key, so React's first client render agrees with the DOM the
      // script left and hydration has nothing to repair. The same arrangement
      // as `hidden` on the rail itself.
      aria-pressed={width === "icons"}
      title="Icons only"
      onClick={() => onPick(width === "icons" ? "full" : "icons")}
      className="flex min-h-[var(--tap)] w-full items-center gap-2 px-3 text-[12px] text-muted hover:bg-sunk hover:text-ink group-data-[rail=icons]:justify-center group-data-[rail=icons]:gap-0 group-data-[rail=icons]:px-0"
    >
      <Chevrons />
      <span className="group-data-[rail=icons]:sr-only">Icons only</span>
    </button>
  );
}

/** Pointing at the edge the rail would move towards, whichever width it is. */
function Chevrons(): React.ReactElement {
  return (
    <svg
      aria-hidden="true"
      width="12"
      height="12"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      className="shrink-0"
    >
      <g className="group-data-[rail=icons]:hidden">
        <polyline points="7,3 3,7 7,11" />
        <polyline points="12,3 8,7 12,11" />
      </g>
      <g className="hidden group-data-[rail=icons]:block">
        <polyline points="7,3 11,7 7,11" />
        <polyline points="2,3 6,7 2,11" />
      </g>
    </svg>
  );
}

/**
 * The rail's width, remembered per viewer.
 *
 * NOT `useCollapsible`, and the reason is the one src/lib/chrome.ts gives for
 * `Widthable` not being a `Collapsible`: that hook is about a part being on
 * the page or not, and its stored vocabulary is open/closed. What is shared is
 * everything that matters — the same storage helpers, the same lazy
 * initialiser so hydration meets the script's DOM, and the same counting
 * (ARCHITECTURE.md principle 5), because whether anybody ever reaches for the
 * icon rail is the only evidence there will be about whether it earns its
 * place.
 */
function useRailWidth(): [Width, (next: Width) => void] {
  const [stored, setStored] = useState<string | null>(() => readChoice(RAIL_WIDTH.key));
  const width = widthOf(stored, WIDTH_DEFAULT);

  const set = useCallback((next: Width): void => {
    setStored(next);
    writeChoice(RAIL_WIDTH.key, next);
    logAction("shell.rail.width", { width: next });
  }, []);

  return [width, set];
}
