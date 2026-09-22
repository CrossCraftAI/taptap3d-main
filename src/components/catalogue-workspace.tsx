"use client";

import { useState } from "react";

import { InlineScript } from "@/components/inline-script";
import { LOTS_PANEL, applyBeforePaint, isOpen, readChoice, writeChoice } from "@/lib/chrome";
import { logAction } from "@/lib/log/client";

/**
 * The editor's frame: two slim rows of tools, then the canvas with the lots
 * panel beside it — and the panel can be put away.
 *
 * ── THE CANVAS IS THE POINT ───────────────────────────────────────────────────
 *
 * Measured on production before this: a header of 130px, a controls bar of 60,
 * the paddings around them, a 224px rail and a 340px panel left the A4 page
 * 22% of a 1440×900 window. The page is sized by HEIGHT to fit the frame
 * (src/lib/render/html.ts), so width given back to the frame does nothing for
 * it — height does. Hence two rows of about 36px each and no padding around
 * the frame at all: the desk inside the frame is the same grey as the shell,
 * so the frame runs to the edges and reads as the window's own floor.
 *
 * Two rows rather than one, measured rather than preferred: title, counts,
 * five controls and two buttons come to some 1,850px of toolbar, and the
 * window is 1,440. One row would wrap to two on its own and take a third on a
 * laptop; declaring the two is what keeps the fold where it is.
 *
 * ── SLOTS, NOT PROPS ─────────────────────────────────────────────────────────
 *
 * Everything shown here is read on the server — the sale, the document, the
 * pins — and arrives as rendered slots; the only state this component owns is
 * whether the panel is showing. A client component that fetched would be a
 * second reader of the same rows (M1.md §2: Server Components read).
 *
 * The panel is kept in the DOM with `hidden`, the same way the rail is and
 * for the same reasons: the before-paint script has an element to set, the
 * frame beside it is never remounted — the preview reloads only when its
 * `src` changes and must not be made to at any other time — and `hidden`
 * takes the panel out of the accessibility tree and the tab order together.
 */
export function CatalogueWorkspace({
  catalogueId,
  heading,
  meta,
  actions,
  controls,
  canvas,
  panel,
}: {
  catalogueId: string | null;
  heading: React.ReactNode;
  /**
   * What the document amounts to — template, pages, lots. Placed with the
   * actions rather than after the title: the title says Catalogue and the
   * default template is called Catalogue, and side by side on one row they
   * read as a stutter.
   */
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  controls: React.ReactNode;
  canvas: React.ReactNode;
  /** The lots panel — or null when there are no lots to list, and then no toggle either. */
  panel: React.ReactNode | null;
}): React.ReactElement {
  const [stored, setStored] = useState<string | null>(() => readChoice(LOTS_PANEL.key));
  const open = isOpen(stored, true);
  const setOpen = (next: boolean): void => {
    const choice = next ? "open" : "closed";
    setStored(choice);
    writeChoice(LOTS_PANEL.key, choice);
    logAction("catalogue.panel", { open: next }, catalogueId);
  };

  return (
    // THE BOX THE SHELL HANDS OVER, not 100vh. The shell is one viewport tall
    // and `main` is a flex column inside it (src/components/shell.tsx), so
    // `h-screen` here would be the whole window inside a box that is the
    // window minus the top bar: the editor would grow a scrollbar and put the
    // foot of the page underneath the bar. `flex-1` is that box exactly, and
    // it is the same height as before whenever the bar is away — which on this
    // screen is the default, so the page's measured share of the window
    // (test/e2e/editor.spec.ts) is unchanged.
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="shrink-0 border-b border-rule bg-paper">
        {/* pl-11 clears the rail toggle fixed in the window's corner. */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 py-1.5 pl-11 pr-3">
          {heading}
          <div className="ml-auto flex items-center gap-3">
            {meta}
            {panel !== null && (
              <button
                id={LOTS_PANEL.toggle}
                type="button"
                aria-controls={LOTS_PANEL.id}
                aria-expanded={open}
                title={`${open ? "Hide" : "Show"} the lots panel`}
                onClick={() => setOpen(!open)}
                className={`border border-ruleStrong px-2.5 py-1 text-[12px] font-medium hover:bg-sunk ${
                  open ? "bg-sunk" : "bg-paper"
                }`}
              >
                Lots
              </button>
            )}
            {actions}
          </div>
        </div>
        <div className="border-t border-rule py-1.5 pl-11 pr-3">{controls}</div>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1">{canvas}</div>
        {panel !== null && (
          <>
            <div
              id={LOTS_PANEL.id}
              hidden={!open}
              className="flex min-h-0 w-[340px] shrink-0 flex-col border-l border-rule"
            >
              {panel}
            </div>
            <InlineScript html={applyBeforePaint(LOTS_PANEL, true)} />
          </>
        )}
      </div>
    </div>
  );
}
