"use client";

import type { ToolbarSide } from "@/lib/editor/canvas-geometry";

/**
 * The bar that appears beside a selection, and nowhere else.
 *
 * ── WHY THERE IS A BAR AT ALL, AND WHY IT FLOATS ────────────────────────────
 *
 * Undo and Reset are per-part gestures: they answer "put THIS back", and the
 * part is the thing the specialist is looking at. A permanent row of the same
 * two buttons above the canvas would be two controls that are wrong most of the
 * time — disabled whenever nothing is selected, and ambiguous the rest of the
 * time about which of five hundred lots they act on. It also costs the page:
 * the sheet is height-bound at fit-page, so every horizontal pixel taken off
 * the top costs the sheet's AREA with the square (catalogue-workspace.tsx does
 * that arithmetic and measured 33.7% → 37.3% for removing one such band).
 *
 * So the controls come to the selection. This file is the buttons; where they
 * stand is `toolbarSpot`'s answer, taken over `verticalClearance`'s measurement
 * of the page — above by preference, past a crowded row to the nearest empty
 * band, below when above is full, pinned to the canvas edge when the selection
 * is a full-bleed plate with no outside on screen, and NOT AT ALL when the
 * selection has scrolled away.
 *
 * ── IT IS THE ONE THING ON THIS LAYER THAT TAKES THE POINTER ────────────────
 *
 * Everything else over the preview is `pointer-events: none`, because a layer
 * that takes the pointer takes the wheel and a 43-page flow stops scrolling
 * (selection-overlay.tsx). A button cannot be pressed without taking the
 * pointer, so this is the exception and it is bounded the same way the blank
 * sheet's call to action already is (catalogue/page.tsx): the CONTAINER stays
 * inert and only the bar itself is live, the bar is a few hundred pixels wide,
 * and it exists only while something is selected. It is also hidden while a
 * gesture runs — a bar under the pointer mid-drag is a dead patch exactly where
 * the hand is.
 *
 * ── RESTRAINT, BECAUSE OF WHAT IS UNDERNEATH ────────────────────────────────
 *
 * One hairline, one flat ground, no shadow beyond the pixel that lifts it off a
 * photograph, no animation. The thing behind this bar is a client's unpublished
 * sale; a bar that looked like a design tool would make an auction catalogue
 * look like a draft.
 */

/**
 * How much empty page the bar needs, in overlay pixels.
 *
 * The bar is one row: `--tap` (28px with a precise pointer, 44 under a coarse
 * one — globals.css) plus a hairline either side, plus the 10px of air
 * `toolbarSpot` offsets it by. 44 is therefore the coarse case's real
 * requirement rather than a margin of comfort, and it is stated as one number
 * because `verticalClearance` measures the PAGE and must not become a function
 * of which pointer is attached or of how many buttons this selection happens to
 * offer — that would re-measure every box on the sheet whenever either changed.
 *
 * The number matters in both directions: too large and a genuine band between a
 * plate and its caption stops qualifying, so the bar goes back to standing on
 * the caption; too small and it declares a gap usable and then overlaps it.
 */
export const TOOLBAR_BAND_PX = 44;

/**
 * How far the bar may travel to find that band, in overlay pixels.
 *
 * A 1-up caption stack on this renderer is a handful of rows inside one slot,
 * so this reaches the paper above or below the stack from anywhere inside it —
 * and no further. Past that the bar would be a control floating in the margin
 * of a page, pointing at a row nobody can tell it belongs to, which is the
 * objection `toolbarSpot` already makes about returning a spot for a selection
 * that has scrolled out of sight.
 */
export const TOOLBAR_REACH_PX = 200;

/**
 * The size assumed before the bar has been measured once.
 *
 * A FALLBACK, not the truth: the canvas reads the rendered bar's own box and
 * places the next frame with it (preview-canvas.tsx), because the width depends
 * on which buttons this selection offers and the height on which pointer is
 * attached. This is only what the FIRST frame is placed with, and it is the
 * coarse-pointer height so the first placement errs towards leaving too much
 * room rather than too little.
 */
export const TOOLBAR_FALLBACK = { w: 260, h: TOOLBAR_BAND_PX };

export function SelectionToolbar({
  barRef,
  field,
  placed,
  side,
  at,
  busy,
  canUndo,
  onUndo,
  onReset,
}: {
  /** So the canvas can measure the bar it is placing. See TOOLBAR_FALLBACK. */
  barRef: React.Ref<HTMLDivElement>;
  /** The field this selection is — the second half of the override's key. */
  field: string;
  /** A person placed this part, so there is a placement to reset. */
  placed: boolean;
  side: ToolbarSide;
  at: { x: number; y: number };
  /** A write is in flight. Both buttons go quiet rather than queueing a second. */
  busy: boolean;
  /** This sitting has a placement to take back — not necessarily of this part. */
  canUndo: boolean;
  onUndo: () => void;
  onReset: () => void;
}): React.ReactElement {
  return (
    <div
      ref={barRef}
      data-toolbar=""
      // PUBLISHED, like `data-ring-kind` and for the same reason: "did the bar
      // stand above, below, or give up and pin itself?" depends on the page's
      // own contents, and recovering it from a screenshot means re-deriving the
      // arithmetic under test — the failure the predecessor's audits paid for
      // four times (canvas-geometry.ts, ToolbarSide).
      data-toolbar-side={side}
      className="pointer-events-auto absolute flex items-stretch gap-px border border-ruleStrong bg-paper shadow-[0_1px_2px_rgba(0,0,0,.10)]"
      style={{ left: at.x, top: at.y }}
    >
      {/* WHAT IS SELECTED, IN THE WORD THE OVERRIDE IS KEYED BY. Not the lot's
          reference: the reference is a house's own column and this bar's two
          actions are keyed (lot, field), so naming the field is naming what
          will actually be written. The lot is the thing the ring is around and
          the specialist is looking at it. */}
      <span
        className="flex min-h-[var(--tap)] items-center whitespace-nowrap px-2.5 text-[12px] text-muted"
        title={placed ? "A person placed this part" : "The engine placed this part"}
      >
        {field}
        {placed && <span className="ml-1.5 text-seal">·</span>}
      </span>

      <Action
        label="Undo"
        title="Put the last placement of this sitting back where it was. In-session only: it is not kept when the editor is closed."
        disabled={busy || !canUndo}
        onClick={onUndo}
      />
      {/* THE FAR END, and that is the ordering rather than the layout. The
          control that throws work away stays where it cannot be hit on the way
          to the one that does not. */}
      <Action
        label="Reset placement"
        title="Hand this part back to the engine, which places it again with everything else."
        disabled={busy || !placed}
        onClick={onReset}
      />
    </div>
  );
}

/**
 * One button.
 *
 * `--tap` as a MINIMUM HEIGHT rather than padding, which is the house rule the
 * ledger's controls have stood on since they were written (ledger.tsx) and the
 * catalogue's settings adopted (catalogue-controls.tsx): 28px with a precise
 * pointer, 44 under a coarse one, because a condition check happens on a tablet
 * in a warehouse. The bar grows with the token; `toolbarSpot` is handed the
 * measured height, so the placement follows.
 */
function Action({
  label,
  title,
  disabled,
  onClick,
}: {
  label: string;
  title: string;
  disabled: boolean;
  onClick: () => void;
}): React.ReactElement {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className="min-h-[var(--tap)] whitespace-nowrap border-l border-rule px-2.5 text-[12px] hover:bg-sunk disabled:text-faint disabled:hover:bg-transparent"
    >
      {label}
    </button>
  );
}
