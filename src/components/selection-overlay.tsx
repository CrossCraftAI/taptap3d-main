"use client";

import type { ClipMark, OverlapMark } from "@/lib/editor/overlay-model";
import type { OverlayRect, SelectionRing } from "@/lib/editor/selection-geometry";

/**
 * The chrome drawn over the preview: rings, and the mark for a box that is
 * cutting its own text.
 *
 * ── IT SWALLOWS NO POINTER, AND THAT IS THE WHOLE RULE ──────────────────────
 *
 * `pointer-events: none` on the layer and on every box in it. A transparent
 * `pointer-events: auto` layer over the preview is the obvious build and it is
 * the predecessor's most expensive interface defect: the preview is one
 * document holding every page in a vertical flow, so a layer that takes the
 * pointer takes the WHEEL, and a 43-page catalogue stops scrolling. The parent
 * receives every event through the child document instead (preview-canvas.tsx),
 * and a capture layer is mounted only for the life of a gesture.
 *
 * It follows that nothing here can carry a cursor, a tooltip or a hit box. That
 * is not a limitation to work around; it is what keeps the preview scrollable.
 *
 * ── PAINT ONLY ──────────────────────────────────────────────────────────────
 *
 * Every decision — which box is the accent, whether the picture inside a plate
 * deserves a second outline, whether a box is clipping — was made in
 * overlay-model.ts, where it can be tested without a DOM. This turns the answer
 * into divs. If a number is computed in this file, it is in the wrong file.
 *
 * ── THE ACCENT IS THE SEAL ──────────────────────────────────────────────────
 *
 * There is exactly one chromatic value in this system and it is the seal
 * (src/app/globals.css says why: a specialist proofs a photograph's colour
 * against the ground it sits on, so the interface is true grey). The
 * predecessor's rule — one accent for the thing you are manipulating,
 * everything else grey — survives the palette unchanged. The colours are read
 * from the theme's own variables rather than repeated as hex, so the palette
 * stays in one file.
 *
 * ── AND IT PUBLISHES WHAT IT DREW ───────────────────────────────────────────
 *
 * `data-ring-kind`, `data-ring-key`, `data-clip-axis`. A driven test asking
 * "did the click ring the plate or the caption row" reads an attribute rather
 * than comparing rectangles in a screenshot — the rule the predecessor's audits
 * paid for four times. The key is `selectionKey`'s own JSON, so the lot and the
 * field are in it exactly once and in the injective form the rest of the layer
 * uses.
 */
export function SelectionOverlay({
  rings,
  clips,
  overlaps,
  note,
  selection,
  placements,
}: {
  rings: readonly SelectionRing[];
  clips: readonly ClipMark[];
  /** Hand-placed parts sitting on another lot's ink. */
  overlaps: readonly OverlapMark[];
  /** One sentence about the last gesture, or null. */
  note: string | null;
  /** `selectionKey` of what is selected, for an audit and for nothing else. */
  selection: string | null;
  /** How many placements this sitting has made. See placement-history.ts. */
  placements: number;
}): React.ReactElement {
  return (
    <div
      data-overlay=""
      data-selection={selection ?? ""}
      data-clip-count={clips.length}
      data-overlap-count={overlaps.length}
      data-placements={placements}
      // CLIPPED TO THE CANVAS. A ring around a part that has been scrolled off
      // the top is drawn at a negative offset, and without this it would paint
      // over the toolbar above the frame.
      className="pointer-events-none absolute inset-0 overflow-hidden"
    >
      {rings.map((ring) => (
        <div
          key={ring.key}
          data-ring-kind={ring.kind}
          data-ring-key={ring.key}
          data-ring-scope={ring.scope ?? undefined}
          className="pointer-events-none absolute"
          style={{ ...box(ring.rect), ...RING[ring.kind], ...turn(ring.rotationDeg) }}
        />
      ))}
      {clips.map((mark) => (
        <ClipEdges key={mark.key} mark={mark} />
      ))}
      {/* THE INTERSECTION, not the part. Outlining the whole placed box would
          say "this part is wrong"; the part is fine, and what wants looking at
          is the region where it lands on somebody else's line. A wash rather
          than a ring, because a ring here would be a fourth kind of rectangle
          on a surface that already has three and means something by each.

          The seal is right for once without argument: this is the accent's own
          sentence — a person is needed here. */}
      {overlaps.map((mark) => (
        <div
          key={mark.key}
          data-overlap-key={mark.key}
          className="pointer-events-none absolute bg-seal/15 outline outline-1 outline-seal/40"
          style={box(mark.rect)}
        />
      ))}
      {note !== null && (
        /* At the foot of the canvas, where the empty page's own call to action
           stands, so the two never argue about the same corner. It takes no
           pointer either: a message that could eat the wheel would be the same
           defect as the layer above it, arriving in a smaller box. */
        <div className="pointer-events-none absolute inset-x-0 bottom-6 flex justify-center px-6">
          <p
            data-overlay-note=""
            className="max-w-[40rem] border border-seal bg-sealSoft px-3 py-1.5 text-[12px] text-ink shadow-[0_1px_2px_rgba(0,0,0,.08)]"
          >
            {note}
          </p>
        </div>
      )}
    </div>
  );
}

function box(rect: OverlayRect): React.CSSProperties {
  return { left: rect.x, top: rect.y, width: rect.w, height: rect.h };
}

/**
 * The ring turns about its own centre, which is the same transform the renderer
 * applies to the ink — so the two agree by construction rather than by two
 * copies of the same trigonometry. Nothing publishes an angle yet; the ring is
 * ready for the tranche that does.
 */
function turn(deg: number | undefined): React.CSSProperties {
  return deg === undefined || deg === 0 ? {} : { transform: `rotate(${deg}deg)` };
}

/**
 * The weight of each ring.
 *
 * A HALO ON THE ACCENT ONLY. A hairline on a dark photograph is a hairline
 * nobody can see, and the accent is the one ring a specialist is looking for;
 * the quieter kinds sit on captions and on paper, where grey on white is
 * legible on its own and a white glow would only add noise.
 *
 * The muted kind is DASHED rather than a fainter solid. It is the only ring
 * that describes something other than what the pointer acts on — the frame in
 * subject mode, the picture inside a plate — and a difference in weight alone
 * reads as "further away" rather than as "a different kind of thing".
 */
const RING: Record<SelectionRing["kind"], React.CSSProperties> = {
  selected: {
    outline: "1.5px solid var(--color-seal)",
    boxShadow: "0 0 0 3px rgba(255,255,255,.65)",
  },
  subject: {
    outline: "1.5px solid var(--color-seal)",
    boxShadow: "0 0 0 3px rgba(255,255,255,.65)",
  },
  hover: { outline: "1px solid var(--color-ruleStrong)" },
  muted: { outline: "1px dashed var(--color-faint)" },
};

/**
 * The mark for a box that is cutting its own text: a rule along the edge the
 * cut happens at.
 *
 * A RULE AND NOT AN OUTLINE, so it cannot be mistaken for a selection. An
 * outline says "this is the box you have"; this says "the page is trimmed
 * here", which is the same thing a trim mark says on a printer's proof. Both
 * edges are drawn when both are cut, because a box too narrow AND too short is
 * two problems and fixing one leaves the other.
 *
 * Inside the box by its own thickness, so the mark is on the ink it is about
 * rather than on the lot beneath it.
 */
function ClipEdges({ mark }: { mark: ClipMark }): React.ReactElement {
  const common = {
    background: "var(--color-seal)",
  } satisfies React.CSSProperties;
  return (
    <div
      data-clip=""
      data-clip-key={mark.key}
      data-clip-axis={mark.axis}
      data-clip-px={Math.round(mark.overflowPx)}
      className="pointer-events-none absolute"
      style={box(mark.rect)}
    >
      {mark.axis !== "x" && (
        <span
          className="pointer-events-none absolute inset-x-0 bottom-0 block h-[2px]"
          style={common}
        />
      )}
      {mark.axis !== "y" && (
        <span
          className="pointer-events-none absolute inset-y-0 right-0 block w-[2px]"
          style={common}
        />
      )}
    </div>
  );
}
