"use client";

import Link from "next/link";
import type { Route } from "next";
import { useState } from "react";

import { InlineScript } from "@/components/inline-script";
import { useCollapsible } from "@/components/use-collapsible";
import { PALETTE, applyBeforePaint } from "@/lib/chrome";
import { logAction } from "@/lib/log/client";
import {
  matchesSearch,
  rowsOf,
  type PaletteGroup,
  type PalettePanel,
  type PaletteRow,
} from "@/lib/palette";

/**
 * The palette: a spine of panels, and in each one a catalogue of what you can
 * make from here.
 *
 * ── THE SHAPE IS MAILCHIMP'S, THE CONTENTS ARE OURS ─────────────────────────
 *
 * A 44px spine of icon buttons, a 300px body, a head sentence, a search, and
 * `<details>` groups of DESCRIBED rows: a name, one sentence, and the verb of
 * what happens. src/lib/palette.ts holds the catalogue and says why it is
 * short — the drawing names 111 objects and this product can do a handful of
 * them, and a row that names a capability it does not have is the defect this
 * whole component is under instruction to avoid.
 *
 * Clicking the OPEN panel's own spine button closes the panel, so the work can
 * have the width back without hunting for a different control.
 *
 * ── `aria-expanded`, NOT `role="tab"` ───────────────────────────────────────
 *
 * The drawing made the spine a `tablist` of `tab`s. A tab list promises arrow
 * keys and a panel that is always showing one of its tabs, and this is
 * neither: the buttons can all be off. They are disclosures — two buttons
 * revealing one region, each saying whether what it reveals is showing — which
 * is what they behave like, and it is the same word (`aria-expanded`) the rail
 * and the top bar use for the same idea.
 *
 * ── WHAT IS NOT BUILT ───────────────────────────────────────────────────────
 *
 * No drag. In the drawing a row is dragged onto the page, and there is nothing
 * in this product that accepts such a drop yet; `draggable` on a row that
 * cannot be dropped anywhere is a gesture that ends in nothing happening. No
 * in-panel TAB STRIP either — the drawing's Add panel has Parts and Templates,
 * we have neither, and a strip of one tab is a control with no second state.
 * The spine is the only axis with two real things on it.
 */
export function Palette({
  panels,
  /** True when the rest of the chrome is away, so the corner button overlaps. */
  clearCorner,
}: {
  panels: PalettePanel[];
  clearCorner: boolean;
}): React.ReactElement | null {
  const first = panels[0];
  const [picked, setPicked] = useState<string | null>(null);
  const [open, setOpen] = useCollapsible(PALETTE, false, "shell.palette");

  // An empty catalogue means no chrome at all: a spine that opens onto nothing
  // is a control that promises something is in there.
  if (!first) return null;

  const active = panels.find((panel) => panel.key === picked) ?? first;
  // Which button carries `aria-expanded="true"` before React exists depends on
  // which panels this route has, so the before-paint script is pointed at the
  // one the component will also pick — the first.
  const part = { ...PALETTE, toggle: spineId(first.key) };

  const pick = (key: string): void => {
    if (open && key === active.key) {
      setOpen(false);
      return;
    }
    setPicked(key);
    if (!open) setOpen(true);
  };

  return (
    <aside
      aria-label="What you can add"
      // Away below md, the same as the rail and for the same reason: this
      // application has no phone chrome yet, and a palette spine beside a page
      // with no navigation rail is half a shell. The drawing's answer at that
      // width — the body becomes a sheet over the work — is the right one and
      // it belongs with whatever gives the rail a phone form.
      //
      // No border of its own: the spine and the body each draw their right
      // edge, so one here would double the line at whichever of them is last.
      className="flex shrink-0 max-md:hidden"
    >
      <div
        className={`flex w-11 shrink-0 flex-col border-r border-rule bg-field ${
          // The rail's toggle is fixed in the window's corner and stays there
          // when the rest of the chrome is away; without this the first spine
          // button sits underneath it.
          clearCorner ? "pt-8" : ""
        }`}
      >
        {panels.map((panel) => {
          const showing = open && panel.key === active.key;
          return (
            <button
              key={panel.key}
              id={spineId(panel.key)}
              type="button"
              aria-controls={PALETTE.id}
              aria-expanded={showing}
              aria-label={panel.label}
              title={panel.label}
              onClick={() => pick(panel.key)}
              className={`grid h-10 shrink-0 place-items-center border-l-2 text-[15px] ${
                showing
                  ? "border-ink bg-paper text-ink"
                  : "border-transparent text-muted hover:bg-paper hover:text-ink"
              }`}
            >
              <span aria-hidden="true">{panel.icon}</span>
            </button>
          );
        })}
      </div>

      <div
        id={PALETTE.id}
        hidden={!open}
        className="w-[300px] border-r border-rule bg-paper"
      >
        {/* Keyed on the panel, so switching panels clears the search rather
            than showing the next panel already filtered by a word typed for
            the last one. */}
        <Body key={active.key} panel={active} />
      </div>
      <InlineScript html={applyBeforePaint(part, false)} />
    </aside>
  );
}

const spineId = (key: string): string => `palette-pick-${key}`;

function Body({ panel }: { panel: PalettePanel }): React.ReactElement {
  const [query, setQuery] = useState("");
  const groups: PaletteGroup[] = panel.groups
    .map((group) => ({
      ...group,
      rows: group.rows.filter((row) => matchesSearch(row, query)),
    }))
    .filter((group) => group.rows.length > 0);
  const total = rowsOf(panel).length;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-rule px-3 py-2">
        <h2 className="text-[13px] font-semibold">{panel.label}</h2>
        <p className="mt-0.5 text-[12px] leading-snug text-muted">{panel.head}</p>
      </div>

      {/* SHOWN WHATEVER THE COUNT. Rejected: hiding it below some number of
          rows — a control that comes and goes with the contents is one nobody
          learns is there, and the catalogue grows a row per capability. */}
      <div className="border-b border-rule px-3 py-2">
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search…"
          aria-label="Search what you can add"
          className="w-full border border-rule bg-field px-2 py-1 text-[13px] placeholder:text-faint"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {groups.length === 0 ? (
          // A STATE THE DRAWING NEVER SHOWS. Both halves are real: nothing
          // matched, and here is how much there was to match against.
          <p className="px-3 py-6 text-[12px] leading-relaxed text-muted">
            Nothing here matches “{query.trim()}”. This panel has{" "}
            {total === 1 ? "one row" : `${total} rows`}.
          </p>
        ) : (
          groups.map((group) => (
            <details key={group.key} open className="border-b border-rule last:border-b-0">
              <summary className="cursor-pointer px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted hover:text-ink">
                {group.name}
              </summary>
              <div>
                {group.rows.map((row) => (
                  <Described key={row.key} row={row} />
                ))}
              </div>
            </details>
          ))
        )}
      </div>
    </div>
  );
}

/**
 * A described row: a name, one sentence, and the verb of what happens.
 *
 * A link rather than a button, for the reason the lot stepper gives: it is a
 * navigation, so it prefetches, it survives a middle click and it works in the
 * moment before the bundle has landed. The PDF is a plain anchor because the
 * answer is a stream of bytes and a client-side navigation has nowhere to put
 * one.
 */
function Described({ row }: { row: PaletteRow }): React.ReactElement {
  const inside = (
    <>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-medium text-ink">{row.name}</span>
        <span className="mt-0.5 block text-[12px] leading-snug text-muted">
          {row.note}
        </span>
      </span>
      <span className="shrink-0 border border-ruleStrong bg-paper px-2 py-0.5 text-[12px] text-ink group-hover:border-ink">
        {row.verb}
      </span>
    </>
  );
  const className =
    "group flex w-full items-start gap-2 border-t border-rule px-3 py-2 text-left first:border-t-0 hover:bg-field";
  const count = (): void => logAction("palette.pick", { row: row.key });

  return row.stream ? (
    <a href={row.href} onClick={count} className={className}>
      {inside}
    </a>
  ) : (
    <Link href={row.href as Route} onClick={count} className={className}>
      {inside}
    </Link>
  );
}
