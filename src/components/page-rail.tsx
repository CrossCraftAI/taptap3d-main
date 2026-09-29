"use client";

import { useEffect, useRef } from "react";

import type { PageProxy } from "@/lib/render/template-preview";

/**
 * Where you are in the document, and the way to anywhere else in it.
 *
 * ── THE PROBLEM, STATED AS A MEASUREMENT ───────────────────────────────────
 *
 * A forty-page catalogue is one continuous scroll in one iframe. There is no
 * page number in the chrome, no field to type one into and nothing to press:
 * reaching page 23 means dragging a scrollbar and watching sheets go past.
 * `currentPageIndex` and `pageScrollTop` were written for this in Phase 4b and
 * have had no caller since.
 *
 * ── WHY IT IS DIAGRAMS AND NOT A LIST OF NUMBERS ───────────────────────────
 *
 * A list of numbers answers "which page is 23" and a specialist is never
 * asking that. They are looking for the spread with the big vertical scroll on
 * it, or the page where the plates go small, or the one sheet in a run of
 * grids — all of which are SHAPES, and all of which a proxy shows and a number
 * cannot. The proxies come from the same engine that drew the sheet beside
 * them (`documentPages`), so a page that changed shape changes here too.
 *
 * ── EVERY PAGE, AND THE COLUMN SCROLLS ─────────────────────────────────────
 *
 * No cap, no pager, nothing collapsed behind a "27 more". A rail that hides
 * pages cannot be scanned, and scanning is what it is for. The current page is
 * scrolled into view as the preview moves, so the rail follows the reader
 * rather than the reader having to find themselves in the rail.
 */

const PICKED = "border-seal bg-sealSoft";
const RESTING = "border-rule bg-paper hover:border-ruleStrong";

export function PageRail({
  pages,
  aspect,
  current,
  onGo,
}: {
  pages: PageProxy[];
  /** Width ÷ height of the sheet, so a proxy is the shape of the paper. */
  aspect: number;
  /** 0-based index of the page the reader is on. */
  current: number;
  onGo: (index: number) => void;
}): React.ReactElement | null {
  const here = useRef<HTMLButtonElement>(null);
  // FOLLOW THE READER, and only when the reader is elsewhere. `nearest` rather
  // than `center`: a proxy already fully in view must not move, or every
  // scroll of the preview would drag the rail under the hand that is about to
  // press it.
  useEffect(() => {
    here.current?.scrollIntoView({ block: "nearest" });
  }, [current]);

  // A sale with no lots has no pages, and an empty box with a heading is worse
  // than no box: it asks the reader to work out what is missing.
  if (pages.length === 0) return null;

  return (
    <nav aria-label="Pages of this catalogue" className="mt-3 border-t border-rule pt-3">
      <h2 className="text-[10px] uppercase tracking-[0.08em] text-muted">
        Pages <span data-numeric>{pages.length}</span>
      </h2>
      <ol className="mt-2 grid list-none grid-cols-2 gap-2 p-0">
        {pages.map((page, index) => {
          const picked = index === current;
          return (
            <li key={page.number}>
              <button
                ref={picked ? here : undefined}
                type="button"
                onClick={() => onGo(index)}
                // THE PAGE NUMBER IS THE NAME. A proxy is a picture and a
                // picture has no accessible name of its own, so without this
                // the rail reads as a column of unlabelled buttons.
                aria-label={`Page ${page.number}`}
                aria-current={picked ? "true" : undefined}
                // THE FLOOR IS DECLARED EVEN THOUGH THE PROXY CLEARS IT
                // THREE TIMES OVER — about 148px at this column's width,
                // because it is the shape of A4. The rule is that a control
                // carries `--tap`, not that it happens to be big today: a
                // narrower column, a landscape template or a rail of six per
                // row would each shrink this, and none of them would think to
                // come back here. test/house-style.test.ts counts it.
                className={`block min-h-[var(--tap)] w-full border p-1 ${
                  picked ? PICKED : RESTING
                }`}
              >
                <span
                  className="relative block w-full bg-paper"
                  style={{ aspectRatio: String(aspect) }}
                >
                  {page.blocks.map((block, n) => (
                    <span
                      key={n}
                      className={`absolute ${
                        block.kind === "plate" ? "bg-sunk" : "bg-rule"
                      }`}
                      style={{
                        left: `${block.x * 100}%`,
                        top: `${block.y * 100}%`,
                        width: `${block.w * 100}%`,
                        height: `${block.h * 100}%`,
                      }}
                    />
                  ))}
                </span>
                <span
                  className={`mt-0.5 block text-center text-[10px] ${
                    picked ? "font-medium text-ink" : "text-faint"
                  }`}
                  data-numeric
                >
                  {page.number}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
