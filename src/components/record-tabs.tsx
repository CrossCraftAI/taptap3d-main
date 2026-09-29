"use client";

import { useState } from "react";

/**
 * The lot record's tabs.
 *
 * ── WHY THE PANELS ARE PROPS AND NOT CHILDREN OF A CLIENT TREE ─────────────
 *
 * Every panel is rendered on the SERVER — the fields forms, the photographs,
 * the import run, the ownership chain — and arrives here as a finished
 * element. This component owns one piece of state and nothing else: which tab
 * is showing. That keeps the page a server component, keeps the existing
 * client forms exactly where they were, and means a tab can hold whatever the
 * page decides to put in it without this file learning about it.
 *
 * ── AND WHY ALL OF THEM ARE IN THE DOCUMENT AT ONCE ────────────────────────
 *
 * `hidden` rather than unmounted, so switching is instant and a half-typed
 * value on one tab is still there when a person comes back from another. A lot
 * record is a screen people work back and forth across, and losing an edit to
 * a tab press would be the product teaching them not to press tabs. The cost
 * is the whole record's markup in one response, which for one lot is a few
 * kilobytes.
 *
 * `hidden` is also what keeps the panels that are not showing out of the
 * accessibility tree and out of the tab order — `aria-hidden` alone would
 * leave every field in them focusable.
 *
 * ── NO TAB IS EVER DISABLED HERE, AND THAT IS A PROPERTY OF THE RECORD ─────
 *
 * The polish panel disables a tab whose treatment the selection cannot take,
 * with the reason on the element. Nothing on this record is like that: every
 * tab holds something for every lot, including the ones whose answer is
 * "nothing recorded" — which is a fact a registrar came to read. So the
 * disabled state is not modelled rather than modelled and never used.
 */

export interface RecordTab {
  id: string;
  label: string;
  /** What is on it, read by a screen reader with the label and shown as a title. */
  hint: string;
  /**
   * How many things are on it, when the count is the reason to press it.
   * Omitted where a count would be meaningless rather than zero.
   */
  count?: number;
  panel: React.ReactNode;
}

const BASE =
  "inline-flex min-h-[var(--tap)] items-center border-b-2 px-3 text-[13px]";

export function RecordTabs({
  tabs,
  label,
}: {
  tabs: RecordTab[];
  /** What this set of tabs is for, for a screen reader. */
  label: string;
}): React.ReactElement {
  const [active, setActive] = useState(tabs[0]!.id);

  return (
    <div className="mt-6">
      <div role="tablist" aria-label={label} className="flex gap-1 border-b border-rule">
        {tabs.map((tab) => {
          const picked = active === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`tab-${tab.id}`}
              aria-controls={`panel-${tab.id}`}
              aria-selected={picked}
              title={tab.hint}
              onClick={() => setActive(tab.id)}
              className={`${BASE} ${
                picked
                  ? "border-seal font-medium text-ink"
                  : "border-transparent text-muted hover:text-ink"
              }`}
            >
              {tab.label}
              {typeof tab.count === "number" && (
                <span className="ml-1.5 text-[10px] text-faint" data-numeric>
                  {tab.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {tabs.map((tab) => (
        <div
          key={tab.id}
          id={`panel-${tab.id}`}
          role="tabpanel"
          aria-labelledby={`tab-${tab.id}`}
          hidden={active !== tab.id}
        >
          {tab.panel}
        </div>
      ))}
    </div>
  );
}
