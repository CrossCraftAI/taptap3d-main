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
      </header>

      <div className="flex min-h-0 flex-1">
        {/* ── THE DOCUMENT'S SETTINGS, BESIDE THE PAGE AND NOT ABOVE IT ─────
            They were a full-width band under the header. A band costs the page
            more than its own height: at fit-page the preview sizes the sheet by
            HEIGHT (render/html.ts), the sheet is A4, so its AREA falls with the
            SQUARE of whatever is taken off the top. That is the same arithmetic
            that made the top bar hide on this screen, and this was the last
            strip standing. Measured before and after in one 1440x900 window:
            33.7% of it, then 37.3%.

            FLOATING IT OVER THE CANVAS WAS TRIED FIRST, because "all the view
            controls over the canvas" is what the plan says, and it cannot work.
            The reason is geometric rather than a matter of taste: measured at
            1440x900 with the sheet fitted to the page, the desk around it is
            236px to the left, 236px to the right and SIXTEEN PIXELS at the top.
            A control bar needs forty. Every horizontal bar over this canvas
            covers the sheet, which is the one thing the screen exists to show.

            Docked to the left it costs nothing, and that is the part worth
            knowing: the sheet is HEIGHT-bound, not width-bound — 585px wide in
            a 1056px canvas — so taking 230px of width away still leaves 826px,
            more than the sheet wants. The page keeps its area and the header
            row's height is pure gain. At fit-width it does cost, which is the
            honest trade of asking for the width.

            The drawing puts it here too, which is a check rather than a reason.
            Next: fold it into the palette's own Document panel so the spine can
            put it away. What makes that more than a move is that these controls
            are ONE stored object — setCatalogueParamsAction re-normalises
            everything it receives, so a panel posting only `template` would
            silently reset the fit and the reference. */}
        {/* ONE INSTANCE, TURNED BY THE FLEX DIRECTION. The first version of
            this rendered {controls} twice — a docked copy and a `lg:hidden`
            strip — and hiding one with CSS hides nothing: both were in the
            document, so every `<select name="template">` existed twice, two
            forms posted the same parameters, and `getByLabel("Template")`
            matched two elements. A control that exists twice is a defect
            before it is a test failure. So the column/row switch is on the
            PARENT and the settings are one element that changes shape. */}
        <div className="flex min-w-0 flex-1 max-lg:flex-col">
          <div className="shrink-0 overflow-y-auto border-rule bg-paper px-3 py-2 max-lg:border-b lg:w-[230px] lg:border-r">
            {controls}
          </div>
          <div className="relative min-h-0 min-w-0 flex-1">{canvas}</div>
        </div>
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
