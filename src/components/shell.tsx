"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { InlineScript } from "@/components/inline-script";
import { Nav } from "@/components/nav";
import {
  RAIL,
  applyBeforePaint,
  isOpen,
  railDefault,
  readChoice,
  writeChoice,
} from "@/lib/chrome";
import { isTyping } from "@/lib/keys";
import { logAction } from "@/lib/log/client";

/**
 * The shell: a rail that can be put away, and content that takes the window
 * when it is.
 *
 * ── ONE BUTTON, ONE PLACE, ONE ELEMENT ───────────────────────────────────────
 *
 * The toggle sits in the top-left corner of the window whether the rail is
 * open or not, and it is the SAME element either way. Two buttons — one inside
 * the rail, one over the content — is the obvious build, and it loses the
 * keyboard: the button a person just pressed disappears with the rail and
 * focus falls to the document body. One fixed element keeps focus where the
 * finger is. Focus that was inside the rail when it closed — a person tabbing
 * the links, then pressing the shortcut — is moved to the toggle rather than
 * lost into a hidden subtree.
 *
 * `hidden`, not conditional rendering: the rail keeps its DOM, the attribute
 * takes it out of the accessibility tree and the tab order together, and the
 * before-paint script (src/lib/chrome.ts) has an element to set it on.
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
 * The rail's PLACES are the Nav's concern and unchanged: a flat list of four,
 * nothing inside it collapses (src/lib/nav.ts). This puts the whole list away.
 */
export function Shell({
  org,
  counts,
  children,
}: {
  org: string | null;
  counts: { events: number; photographs: number; unassigned: number };
  children: React.ReactNode;
}): React.ReactElement {
  const pathname = usePathname();
  // The viewer's CHOICE, or null for "as the route says". Read lazily so the
  // first client render agrees with what the before-paint script did to the
  // DOM; see chrome.ts for why this and not an external store.
  const [stored, setStored] = useState<string | null>(() => readChoice(RAIL.key));
  const fallback = railDefault(pathname);
  const open = isOpen(stored, fallback);

  const rail = useRef<HTMLElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);

  const setOpen = useCallback((next: boolean): void => {
    const choice = next ? "open" : "closed";
    setStored(choice);
    writeChoice(RAIL.key, choice);
    // Counted (principle 5): how often the chrome is wanted back is a fact
    // about the default that nothing else records.
    logAction("shell.rail", { open: next });
    if (!next && rail.current?.contains(document.activeElement)) {
      toggle.current?.focus();
    }
  }, []);

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

  return (
    <div className="flex min-h-screen">
      {/* Fixed in the corner, above everything, on every screen. Hidden below
          md together with the rail it controls, which never showed there. */}
      <button
        id={RAIL.toggle}
        ref={toggle}
        type="button"
        aria-controls={RAIL.id}
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
        className="fixed left-1.5 top-1.5 z-20 hidden h-[26px] w-[26px] items-center justify-center border border-rule bg-paper text-muted hover:text-ink md:flex"
      >
        <RailGlyph open={open} />
      </button>

      {/* THE RAIL IS PRESENT INSIDE THE EDITOR TOO, when it is present at
          all. The predecessor made its editor a separate world reached by a
          link, so an event was somewhere you escaped from rather than
          somewhere you were. Putting the rail away is the viewer's choice and
          one keystroke undoes it; a separate world has no way back. */}
      <aside
        id={RAIL.id}
        ref={rail}
        hidden={!open}
        className="w-56 shrink-0 border-r border-rule bg-paper max-md:hidden"
      >
        <div className="sticky top-0 flex h-screen flex-col px-3 py-4">
          {/* Indented past the corner toggle. */}
          <div className="pl-9 pr-3">
            <p className="text-[15px] font-semibold tracking-tight">taptap3d</p>
            <p className="mt-0.5 truncate text-[12px] text-muted">
              {org ?? "No organisation"}
            </p>
          </div>
          <Nav counts={counts} />
          <p className="mt-auto px-3 text-[11px] leading-relaxed text-faint">
            M1 — the pitch. Catalogue production; no money path.
          </p>
        </div>
      </aside>
      <InlineScript html={applyBeforePaint(RAIL, fallback)} />

      <main className="min-w-0 flex-1">{children}</main>
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
