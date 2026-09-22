"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";

import { InlineScript } from "@/components/inline-script";
import { useCollapsible } from "@/components/use-collapsible";
import {
  NAV_HOUSE,
  NAV_SALE,
  applyBeforePaint,
  type Collapsible,
} from "@/lib/chrome";
import { currentItem, navGroups, openEventId, type NavGroup, type NavItem } from "@/lib/nav";

/**
 * The rail: what is built, in two groups.
 *
 * Places, never actions — a global "Import" cannot know which sale a
 * specialist means, and importing is a row in the palette's Add panel
 * (src/lib/palette.ts) rather than a place here. An object's own header keeps
 * its own buttons; nothing is hoisted up here.
 *
 * ── WHY THERE ARE CATEGORIES AGAIN ──────────────────────────────────────────
 *
 * There were none, deliberately, and src/lib/nav.ts records both the argument
 * and what changed: the list is six places now and two of them are about the
 * one event you have open. The sale's group is first because it is where the
 * day is spent, and it is simply absent on a screen that is not about an
 * event — a category that empties itself rather than showing two rows that
 * point nowhere.
 *
 * ── EXACTLY ONE MARK ────────────────────────────────────────────────────────
 *
 * `/events/x/catalogue` is honestly both "this event's Editor" and the house's
 * "Catalogues". Marking both would leave a person unable to read their own
 * position off the rail, which is the only job it has, so the innermost claim
 * wins and `currentItem` decides it once for the whole rail.
 *
 * ── THE GROUPS REMEMBER, THE SAME WAY EVERYTHING ELSE DOES ──────────────────
 *
 * Each group is a `Collapsible` (src/lib/chrome.ts): localStorage per viewer,
 * applied by an inline script before first paint, read back by a lazy
 * initialiser so hydration meets the DOM the script left. NOT the store and
 * the reopen-the-category-you-are-in effect that the seven-category rail had
 * and that was deleted with it.
 *
 * ── A GROUP HEADING IS `--muted`, NOT `--faint` ─────────────────────────────
 *
 * Small caps at 10px are what `--faint` is for, and that is what the drawing
 * uses. It was written `--muted` because at the time `--color-faint` was
 * `#9a9a9a` on `#ffffff` — 2.8:1, failing at any size and worst at this one —
 * and new text is not painted in a colour that cannot be read. The token has
 * since been fixed to the drawing's own `#58707e` (5.2:1 on paper), so the
 * original objection is gone and a heading COULD move back.
 *
 * It stays `--muted` anyway, for the reason that outlived the contrast one: a
 * group heading and the count beside a row are different jobs, and giving the
 * quietest colour to the thing that organises the list puts the label below
 * the number it is labelling. Proximity and weight should agree.
 */
export function Nav({
  counts,
}: {
  counts: { events: number; photographs: number; unassigned: number };
}): React.ReactElement {
  const pathname = usePathname();
  const groups = navGroups(openEventId(pathname));
  const here = currentItem(groups, pathname);

  return (
    <nav aria-label="Sections" className="mt-5">
      {groups.map((group) => (
        <Group
          key={group.key}
          group={group}
          part={group.key === "sale" ? NAV_SALE : NAV_HOUSE}
          here={here}
          counts={counts}
        />
      ))}
      {/* THE HAIRLINE CLOSES THE LIST. Above it is everything that is built;
          below it is nothing, and the rule is what makes that read as a
          decision rather than as a menu that stopped loading. The roadmap's
          names — custody, channels, administration — are not here as labels
          with "not yet" on them, because a feature list is not a roadmap. */}
      <hr className="mx-3 mt-3 border-0 border-t border-rule" />
    </nav>
  );
}

function Group({
  group,
  part,
  here,
  counts,
}: {
  group: NavGroup;
  part: Collapsible;
  here: NavItem | null;
  counts: { events: number; photographs: number; unassigned: number };
}): React.ReactElement {
  const [open, setOpen] = useCollapsible(part, true, `shell.nav.${group.key}`);

  return (
    <div className="mb-1">
      <button
        id={part.toggle}
        type="button"
        aria-controls={part.id}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-1.5 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.09em] text-muted hover:text-ink"
      >
        <Caret open={open} />
        {group.label}
      </button>

      <ul id={part.id} hidden={!open}>
        {group.items.map((item) => (
          <li key={item.href}>
            <Row item={item} current={item === here} counts={counts} />
          </li>
        ))}
      </ul>
      <InlineScript html={applyBeforePaint(part, true)} />
    </div>
  );
}

function Row({
  item,
  current,
  counts,
}: {
  item: NavItem;
  current: boolean;
  counts: { events: number; photographs: number; unassigned: number };
}): React.ReactElement {
  const total =
    item.count === "events"
      ? counts.events
      : item.count === "photographs"
        ? counts.photographs
        : null;

  return (
    <Link
      // A path built from an event id is a `string` to the compiler whatever
      // it is annotated as; test/nav.test.ts checks every item's route pattern
      // against src/app instead, which reads the filesystem.
      href={item.href as Route}
      aria-current={current ? "page" : undefined}
      className={`flex items-center gap-2 px-3 py-1.5 text-[13px] ${
        current
          ? "bg-sunk font-medium text-ink"
          : "text-muted hover:bg-sunk hover:text-ink"
      }`}
    >
      <span className="flex-1 truncate">{item.label}</span>
      {/* The one number worth interrupting for: how many photographs have
          arrived and not yet been filed. That is the queue, and a queue nobody
          can see is a queue nobody works. */}
      {item.count === "photographs" && counts.unassigned > 0 && (
        <span
          className="bg-seal px-1.5 py-0.5 text-[10px] font-medium text-white"
          title={`${counts.unassigned} not yet on a lot`}
          data-numeric
        >
          {counts.unassigned}
        </span>
      )}
      {total !== null && (
        <span className="text-[10px] text-faint" data-numeric>
          {total}
        </span>
      )}
    </Link>
  );
}

/** Down when the group is open, right when it is shut. */
function Caret({ open }: { open: boolean }): React.ReactElement {
  return (
    <svg
      aria-hidden="true"
      width="9"
      height="9"
      viewBox="0 0 10 10"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      className="shrink-0"
    >
      {open ? <polyline points="2,4 5,7 8,4" /> : <polyline points="4,2 7,5 4,8" />}
    </svg>
  );
}
