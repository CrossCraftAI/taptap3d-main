"use client";

import Link from "next/link";
import type { Route } from "next";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import { logAction } from "@/lib/log/client";
import { switcherRows } from "@/lib/nav";

/**
 * "Which one am I in, and how do I change it?" — in the one strip that is on
 * every screen.
 *
 * ── WHY IT IS UP HERE AT ALL ────────────────────────────────────────────────
 *
 * The editor's own header already names the sale it is showing
 * (src/app/events/[id]/catalogue/page.tsx) — so the mockup's complaint that
 * "nothing said which sale was open" is not true of this product. What was
 * true, and is what this fixes, is the other half: there was no way to CHANGE
 * it without going back to the ledger and finding the row again. Figma, Docs
 * and Qualtrics all put that control in the top bar, and so does this.
 *
 * ── ONE COMPONENT, TWO AXES — THE TENANCY SEAM ──────────────────────────────
 *
 * This is written as ONE AXIS of a switcher and used once, for events. The
 * second axis — WHICH HOUSE — is a second instance of this same component
 * placed immediately before it in src/components/top-bar.tsx, taking orgs
 * where this takes events. Nothing here knows the word "event": the axis
 * arrives as data, so the day the org axis is possible it is a second
 * `<Switcher>` and a second query, not a rewrite.
 *
 * What has to be true first is written down in top-bar.tsx, beside the place
 * it goes.
 *
 * ── A DISCLOSURE, NOT A MENU ────────────────────────────────────────────────
 *
 * The drawing used `role="menu"` with `role="menuitem"` on each row and no
 * arrow-key handling at all, which is a control that tells a screen reader it
 * is a menu and then behaves like a list of links: a person who presses ↓
 * because they were told it is a menu gets nothing. So this is the plain
 * disclosure pattern — a button with `aria-expanded` and `aria-controls`, and
 * real links inside it, which Tab walks natively and which middle-click and
 * open-in-new-tab both work on. A roving-tabindex menu is a bigger, better
 * control and it is not what two to ten rows need.
 *
 * Escape closes it and gives the button back the focus, because focus left
 * inside a panel that has just been removed falls to the document body.
 *
 * ── TEN ROWS AND A SEARCH, NOT EVERY ROW THERE IS ───────────────────────────
 *
 * It used to draw one anchor per sale. Measured on a production build with 484
 * sales: 485 rows, 367,281 bytes on the ledger and 292,682 on the editor,
 * 405 bytes a row, in a panel nobody had opened — and the list was newest-first
 * with no way to find anything in it, which at that length is not a menu, it is
 * an archive with a caret on top.
 *
 * So the panel draws ten and carries a search, and the search reads EVERY sale
 * rather than the ten: a filter over a truncated list would be the worst of
 * both, and the whole set is in the props anyway. src/lib/nav.ts
 * `switcherRows` is where the ten comes from and why the cap is on the paint
 * rather than on the fetch.
 *
 * The SEARCH IS THE PALETTE'S, not a second one — same element, same classes,
 * same placeholder (src/components/palette.tsx). Two search fields in one
 * shell that look different are two controls to learn.
 *
 * ── THE WAY IN IS AT THE FOOT ───────────────────────────────────────────────
 *
 * "New event…" was in the drawing and nothing declared dropping it. From the
 * editor there was no way to START a sale without going to the ledger and
 * finding the quick-add line; this is the way, and it is a LINK to that line
 * rather than a second creation path — src/app/actions.ts `createEventAction`
 * stays the only one. Rejected: a form here, which would be the ledger's
 * quick-add written twice and two places to keep in step with one server
 * action. Rejected: a modal.
 */

export interface SwitcherItem {
  id: string;
  /** What the row and, when it is the open one, the button say. */
  name: string;
  /** The second line: whatever tells two similarly named ones apart. */
  note?: string | null;
  href: string;
}

export function Switcher({
  axis,
  items,
  currentId,
  all,
  create,
}: {
  /** The noun, lower case, for the labels: "event", "house". */
  axis: string;
  items: readonly SwitcherItem[];
  /** The one that is open, or null when the screen is not about any of them. */
  currentId: string | null;
  /** The way out: the place that lists them all. */
  all: { href: string; label: string };
  /** The way in: where a new one is started. Absent when there is nowhere. */
  create?: { href: string; label: string; note: string };
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const button = useRef<HTMLButtonElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const panelId = useId();

  // FROM THE WHOLE SET, never from the drawn rows. The name of the thing you
  // are in must not depend on whether the cap happened to include it, or on
  // what somebody has typed into the search.
  const current = items.find((item) => item.id === currentId) ?? null;
  const { shown, matched, total } = switcherRows(items, currentId, query);
  const typed = query.trim();

  // SHUTTING IT FORGETS WHAT WAS TYPED. A panel that reopens already filtered
  // by a word from the last visit is a panel that looks like it has lost
  // rows, and the palette solves the same problem by keying its body on the
  // panel (src/components/palette.tsx).
  const close = useCallback((): void => {
    setOpen(false);
    setQuery("");
  }, []);

  useEffect(() => {
    if (!open) return;
    // THE SEARCH TAKES THE FOCUS, because finding one of hundreds is what the
    // panel is for and the alternative is a press to open and a press to
    // reach the only field in it. Escape still closes from here — the listener
    // below is on the window, not on the button.
    search.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      close();
      button.current?.focus();
    };
    // Pointerdown rather than click: a click listener on the document fires
    // after the link inside has already navigated, and closing is then a state
    // update on a page that is leaving. `contains` is asked of the WRAPPER so
    // the button's own press is not counted as an outside one and does not
    // close and reopen in the same gesture.
    const onDown = (event: PointerEvent): void => {
      if (!wrap.current?.contains(event.target as Node)) close();
    };
    window.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open, close]);

  return (
    <div ref={wrap} className="relative flex min-w-0">
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        // The full name, for the one it truncates. A disabled variant of this
        // control does not exist: the caller does not render a switcher when
        // there is nothing to switch between, because a greyed control that
        // explains itself in a tooltip is still a control someone will press.
        title={current ? `${current.name} — change which ${axis} is open` : `Open an ${axis}`}
        onClick={() => (open ? close() : setOpen(true))}
        className="flex min-w-0 items-center gap-1.5 border border-transparent px-1.5 py-0.5 text-[13px] font-semibold text-ink hover:border-ruleStrong hover:bg-paper aria-expanded:border-ruleStrong aria-expanded:bg-paper"
      >
        {/* TRUNCATED, AND THAT IS THE ONLY PLACE IT IS DESIGNED FOR. A 中文 sale
            title runs long and the top bar is the one strip that may not wrap;
            max-w keeps the switcher from pushing everything else off the row,
            and the full string stays in the title attribute. */}
        <span className="max-w-[34vw] truncate">
          {current?.name ?? all.label}
        </span>
        <Caret />
      </button>

      {/* THE MAX-HEIGHT IS ON THE PANEL, NOT ON THE LIST. It used to be on the
          `<ul>`, which was the whole panel; with a search above and a foot
          below, a list capped at 70vh makes a panel taller than the window.
          The list is the only part that scrolls, the same arrangement the
          palette's body uses. */}
      <div
        id={panelId}
        hidden={!open}
        className="absolute left-0 top-[calc(100%+4px)] z-40 flex max-h-[70vh] min-w-[280px] max-w-[min(26rem,90vw)] flex-col border border-ruleStrong bg-paper shadow-[0_6px_22px_rgba(0,0,0,.14)]"
      >
        {/* SHOWN WHATEVER THE COUNT, for the palette's reason: a control that
            comes and goes with the contents is one nobody learns is there. */}
        <div className="shrink-0 border-b border-rule px-3 py-2">
          <input
            ref={search}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search…"
            aria-label={`Search ${axis}s`}
            className="min-h-[var(--tap)] w-full border border-rule bg-field px-2 text-[13px] placeholder:text-faint"
          />
        </div>

        <ul className="min-h-0 flex-1 overflow-y-auto py-1">
          {/* THE WAY OUT SITS AT THE TOP OF THE MENU THAT NAMES THE THING.
              Leaving a sale had no control at all before this; it was "press
              Back enough times". It is also where everything the cap left out
              lives, which is what makes the cap cost one more click rather
              than a sale nobody can reach. */}
          <li>
            <Row
              href={all.href}
              current={current === null}
              onPick={() => {
                close();
                logAction("shell.switch", { axis, to: null });
              }}
            >
              <span className="text-[13px]">{all.label}</span>
            </Row>
          </li>
          {/* Only when it has something to separate. A search that matched
              nothing would otherwise draw this rule immediately above the
              sentence saying so, which draws its own. */}
          {shown.length > 0 && (
            <li aria-hidden="true" className="my-1 border-t border-rule" />
          )}
          {shown.map((item) => (
            <li key={item.id}>
              <Row
                href={item.href}
                current={item.id === currentId}
                onPick={() => {
                  close();
                  // `by` says whether the search was what found it — which is
                  // the only way to learn afterwards whether ten was the right
                  // number, and it cannot be asked retrospectively
                  // (ARCHITECTURE.md principle 5).
                  logAction("shell.switch", {
                    axis,
                    to: item.id,
                    by: typed ? "search" : "list",
                  });
                }}
              >
                <span className="block truncate text-[13px] font-medium">
                  {item.name}
                </span>
                {item.note && (
                  <span className="mt-0.5 block truncate text-[12px] text-muted">
                    {item.note}
                  </span>
                )}
              </Row>
            </li>
          ))}
        </ul>

        {/* WHAT IS NOT ON SCREEN, SAID OUT LOUD. A list that silently stops at
            ten reads as a list of ten; the palette's empty state makes the
            same promise the other way round, by saying how much there was to
            match against. */}
        {(shown.length < matched || matched === 0) && (
          <p className="shrink-0 border-t border-rule px-3 py-2 text-[12px] leading-snug text-muted">
            {matched === 0 ? (
              <>
                Nothing here matches “{typed}”. This house has{" "}
                <span data-numeric>{total}</span>{" "}
                {total === 1 ? axis : `${axis}s`}; {all.label} has every one.
              </>
            ) : typed ? (
              <>
                The first <span data-numeric>{shown.length}</span> of{" "}
                <span data-numeric>{matched}</span> that match.
              </>
            ) : (
              <>
                The <span data-numeric>{shown.length}</span> most recently
                touched, of <span data-numeric>{total}</span>. Search for any of
                the rest.
              </>
            )}
          </p>
        )}

        {create && (
          <div className="shrink-0 border-t border-rule py-1">
            <Row
              href={create.href}
              current={false}
              onPick={() => {
                close();
                logAction("shell.create", { axis });
              }}
            >
              <span className="block text-[13px] font-medium">
                {create.label}
              </span>
              <span className="mt-0.5 block text-[12px] leading-snug text-muted">
                {create.note}
              </span>
            </Row>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * One row. A LINK, not a button: it is a navigation, so it prefetches, it
 * opens in a new tab on a middle click, and it works before the bundle lands.
 * The tick's column is held open on every row so the names line up whether or
 * not one of them is ticked.
 */
function Row({
  href,
  current,
  onPick,
  children,
}: {
  href: string;
  current: boolean;
  onPick: () => void;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <Link
      // `typedRoutes` cannot check a path built from an id at runtime; the
      // patterns behind these are checked against src/app in test/nav.test.ts,
      // which reads the filesystem and is the stronger guard.
      href={href as Route}
      aria-current={current ? "true" : undefined}
      onClick={onPick}
      className={`flex min-w-0 items-start gap-2 px-2.5 py-1.5 hover:bg-field ${
        current ? "bg-sunk" : ""
      }`}
    >
      <span aria-hidden="true" className="w-3 shrink-0 text-[12px] text-ink">
        {current ? "✓" : ""}
      </span>
      <span className="min-w-0 flex-1">{children}</span>
    </Link>
  );
}

function Caret(): React.ReactElement {
  return (
    <svg
      aria-hidden="true"
      width="9"
      height="9"
      viewBox="0 0 10 10"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      className="shrink-0 text-muted"
    >
      <polyline points="2,4 5,7 8,4" />
    </svg>
  );
}
