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
import {
  currentItem,
  navGroups,
  openEventId,
  type NavGroup,
  type NavIcon,
  type NavItem,
} from "@/lib/nav";

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
 *
 * ── THE ICON RAIL, AND WHY NOTHING HERE READS THE WIDTH ─────────────────────
 *
 * The rail has two widths (src/lib/chrome.ts) and this component does not know
 * which one it is in. Everything that differs is a `group-data-[rail=icons]:`
 * variant of a class, keyed off the `data-rail` attribute the shell puts on
 * the rail — because the width is a stored per-viewer choice applied by a
 * script BEFORE first paint, and a component that branched on it would render
 * the route's default for the first few milliseconds of every hard load. That
 * is the flash the whole before-paint mechanism exists to prevent, and it
 * would be reintroduced here by one ternary.
 *
 * WHAT COLLAPSES AND WHAT DOES NOT. At 44px the label, the count and the
 * unassigned badge stop being drawn — but every one of them stays in the
 * document as `sr-only`, so the accessible name of a row in the icon rail is
 * the same sentence it is at full width, numbers included. An icon that needs
 * a hover to be understood is decoration with a click handler; every row also
 * carries a `title`, which is what a sighted person gets in place of the
 * label. The badge leaves a 6px mark behind it, because "there is a queue" is
 * the one thing the rail interrupts for and it has to survive the narrowing.
 *
 * THE GROUP HEADINGS STAY, AS THEIR CARET ALONE. Dropping them was the first
 * try and it is a trap: a group the viewer had collapsed would have no control
 * left to reopen it, so the rail would come back narrow and permanently
 * missing four places. A centred caret is a divider that is also the way out.
 *
 * ── THE SALE'S OWN NUMBER ───────────────────────────────────────────────────
 *
 * Lots carries a count now, beside the two the house already had. A specialist
 * standing in a sale is the person who wants to know how big it is, and this
 * rail was the one place that could say so and did not. `lots` is NULLABLE
 * rather than defaulted to nought, and that is the whole care in it: nought
 * lots is a real and useful answer — a sale created and not yet imported —
 * while "the shell could not find that sale" is not an answer at all, and
 * painting the two the same way is a number that means something other than
 * what it says.
 */

/** The rail's numbers. `lots` is null when no sale is open, or none is known. */
export interface NavCounts {
  events: number;
  photographs: number;
  unassigned: number;
  lots: number | null;
}

export function Nav({
  counts,
}: {
  counts: NavCounts;
}): React.ReactElement {
  const pathname = usePathname();
  const groups = navGroups(openEventId(pathname));
  const here = currentItem(groups, pathname);

  return (
    // ROOM FOR THE CORNER BUTTON, AT THE NARROW WIDTH ONLY. The rail's toggle
    // is fixed in the window's corner and is 26px square, so it lies over the
    // top-left of whatever the rail draws first. At 224px that costs four
    // pixels of the first group heading's top padding out of a control 224
    // wide, and nothing is unreachable. At 44px the same four pixels are
    // three-quarters of the control's width, because the column IS the
    // control — so the list starts below the button instead. The palette's
    // spine solves the same collision the same way (`clearCorner`).
    <nav aria-label="Sections" className="mt-5 group-data-[rail=icons]:mt-9">
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
      <hr className="mx-3 mt-3 border-0 border-t border-rule group-data-[rail=icons]:mx-2" />
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
  counts: NavCounts;
}): React.ReactElement {
  const [open, setOpen] = useCollapsible(part, true, `shell.nav.${group.key}`);

  return (
    <div className="mb-1">
      <button
        id={part.toggle}
        type="button"
        aria-controls={part.id}
        aria-expanded={open}
        title={group.label}
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-1.5 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.09em] text-muted hover:text-ink group-data-[rail=icons]:justify-center group-data-[rail=icons]:gap-0 group-data-[rail=icons]:px-0"
      >
        <Caret open={open} />
        <span className="group-data-[rail=icons]:sr-only">{group.label}</span>
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
  counts: NavCounts;
}): React.ReactElement {
  const total =
    item.count === "events"
      ? counts.events
      : item.count === "photographs"
        ? counts.photographs
        : item.count === "lots"
          ? counts.lots
          : null;

  return (
    <Link
      // A path built from an event id is a `string` to the compiler whatever
      // it is annotated as; test/nav.test.ts checks every item's route pattern
      // against src/app instead, which reads the filesystem.
      href={item.href as Route}
      aria-current={current ? "page" : undefined}
      // ALWAYS, NOT ONLY WHEN NARROW. In the icon rail it is the only thing a
      // sighted person has instead of the label; at full width it is the same
      // promise the ledger's own truncated link makes (src/components/
      // ledger.tsx), because this row truncates too and a name cut off at the
      // rail's edge is otherwise unreachable. The count goes in it for the
      // same reason the label does: at 44px the digits are not drawn.
      title={total === null ? item.label : `${item.label} · ${total}`}
      className={`relative flex items-center gap-2 px-3 py-1.5 text-[13px] group-data-[rail=icons]:justify-center group-data-[rail=icons]:gap-0 group-data-[rail=icons]:px-0 ${
        current
          ? "bg-sunk font-medium text-ink"
          : "text-muted hover:bg-sunk hover:text-ink"
      }`}
    >
      <Glyph name={item.icon} />
      <span className="min-w-0 flex-1 truncate group-data-[rail=icons]:sr-only">
        {item.label}
      </span>
      {/* The one number worth interrupting for: how many photographs have
          arrived and not yet been filed. That is the queue, and a queue nobody
          can see is a queue nobody works. */}
      {item.count === "photographs" && counts.unassigned > 0 && (
        <>
          <span
            className="bg-seal px-1.5 py-0.5 text-[10px] font-medium text-white group-data-[rail=icons]:sr-only"
            title={`${counts.unassigned} not yet on a lot`}
            data-numeric
          >
            {counts.unassigned}
          </span>
          {/* THE QUEUE SURVIVES THE NARROWING as a mark rather than a number.
              The digits are still in the row's accessible name above — this
              is the sighted half, and it is `aria-hidden` so the count is not
              announced twice. */}
          <span
            aria-hidden="true"
            className="absolute right-1 top-1 hidden h-1.5 w-1.5 bg-seal group-data-[rail=icons]:block"
          />
        </>
      )}
      {total !== null && (
        <span
          className="text-[10px] text-faint group-data-[rail=icons]:sr-only"
          data-numeric
        >
          {total}
        </span>
      )}
    </Link>
  );
}

/**
 * The rail's glyphs.
 *
 * ── THE HOUSE'S DRAWING RULES, NOT A PACK ───────────────────────────────────
 *
 * Stroked, square, no fill, `currentColor`, on a 14×14 box — the same as the
 * shell's `RailGlyph`, the lot stepper's `Chevron` and the lot record's
 * `Padlock`. That is why there is no icon dependency here: four glyph sets in
 * this repository already agree on one drawing, and a pack would arrive with
 * its own weight, its own box and its own idea of a corner radius, which is
 * three ways for a rail row to stop matching the chevron beside it.
 *
 * EXHAUSTIVE BY THE TYPE. `Record<NavIcon, …>` is what makes "every row has a
 * glyph" a compile error rather than a blank 44px square somebody notices in
 * front of a customer; src/lib/nav.ts makes the field required at the other
 * end of the same guarantee.
 *
 * `shrink-0`, because the row is a flex box and a 14px glyph beside a long
 * label is exactly the thing a flex container squashes first.
 */
const GLYPHS: Record<NavIcon, React.ReactElement> = {
  // A ruled book: a frame, a heading rule, and the lines under it.
  ledger: (
    <>
      <rect x="1.5" y="2" width="11" height="10" />
      <line x1="1.5" y1="5" x2="12.5" y2="5" />
      <line x1="4" y1="8" x2="10" y2="8" />
      <line x1="4" y1="10" x2="10" y2="10" />
    </>
  ),
  // A photograph: a frame, a sun, a horizon.
  plate: (
    <>
      <rect x="1.5" y="2.5" width="11" height="9" />
      <circle cx="4.75" cy="5.5" r="1" />
      <polyline points="1.5,10 5,6.5 8,9.5 10.5,7.5 12.5,9.5" />
    </>
  ),
  // A catalogue page: a plate on it and a caption under it.
  page: (
    <>
      <rect x="2.5" y="1.5" width="9" height="11" />
      <rect x="4" y="3" width="6" height="4" />
      <line x1="4" y1="9" x2="10" y2="9" />
      <line x1="4" y1="11" x2="8" y2="11" />
    </>
  ),
  // Things in a sale: four of them.
  objects: (
    <>
      <rect x="1.5" y="1.5" width="4.5" height="4.5" />
      <rect x="8" y="1.5" width="4.5" height="4.5" />
      <rect x="1.5" y="8" width="4.5" height="4.5" />
      <rect x="8" y="8" width="4.5" height="4.5" />
    </>
  ),
  // Examining: a glass.
  lens: (
    <>
      <circle cx="6" cy="6" r="4" />
      <line x1="9" y1="9" x2="12.5" y2="12.5" />
    </>
  ),
  // Custody: from somewhere, to somewhere.
  route: (
    <>
      <line x1="1.5" y1="4" x2="1.5" y2="10" />
      <line x1="1.5" y1="7" x2="11" y2="7" />
      <polyline points="8,3.5 11.5,7 8,10.5" />
    </>
  ),
  // The house's own answers: two things set to two positions.
  sliders: (
    <>
      <line x1="1.5" y1="4.5" x2="12.5" y2="4.5" />
      <line x1="1.5" y1="9.5" x2="12.5" y2="9.5" />
      <circle cx="5" cy="4.5" r="1.6" />
      <circle cx="9.5" cy="9.5" r="1.6" />
    </>
  ),
};

function Glyph({ name }: { name: NavIcon }): React.ReactElement {
  return (
    <svg
      aria-hidden="true"
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      className="shrink-0"
    >
      {GLYPHS[name]}
    </svg>
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
