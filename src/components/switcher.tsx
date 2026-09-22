"use client";

import Link from "next/link";
import type { Route } from "next";
import { useEffect, useId, useRef, useState } from "react";

import { logAction } from "@/lib/log/client";

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
}: {
  /** The noun, lower case, for the labels: "event", "house". */
  axis: string;
  items: readonly SwitcherItem[];
  /** The one that is open, or null when the screen is not about any of them. */
  currentId: string | null;
  /** The way out: the place that lists them all. */
  all: { href: string; label: string };
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const panelId = useId();

  const current = items.find((item) => item.id === currentId) ?? null;

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      setOpen(false);
      button.current?.focus();
    };
    // Pointerdown rather than click: a click listener on the document fires
    // after the link inside has already navigated, and closing is then a state
    // update on a page that is leaving. `contains` is asked of the WRAPPER so
    // the button's own press is not counted as an outside one and does not
    // close and reopen in the same gesture.
    const onDown = (event: PointerEvent): void => {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

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
        onClick={() => setOpen(!open)}
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

      <div
        id={panelId}
        hidden={!open}
        className="absolute left-0 top-[calc(100%+4px)] z-40 min-w-[280px] max-w-[min(26rem,90vw)] border border-ruleStrong bg-paper shadow-[0_6px_22px_rgba(0,0,0,.14)]"
      >
        <ul className="max-h-[70vh] overflow-y-auto py-1">
          {/* THE WAY OUT SITS AT THE TOP OF THE MENU THAT NAMES THE THING.
              Leaving a sale had no control at all before this; it was "press
              Back enough times". */}
          <li>
            <Row
              href={all.href}
              current={current === null}
              onPick={() => {
                setOpen(false);
                logAction("shell.switch", { axis, to: null });
              }}
            >
              <span className="text-[13px]">{all.label}</span>
            </Row>
          </li>
          <li aria-hidden="true" className="my-1 border-t border-rule" />
          {items.map((item) => (
            <li key={item.id}>
              <Row
                href={item.href}
                current={item.id === currentId}
                onPick={() => {
                  setOpen(false);
                  logAction("shell.switch", { axis, to: item.id });
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
