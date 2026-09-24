"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { toOverlayRect, type OverlayRect } from "@/lib/editor/selection-geometry";
import {
  MARK_RADIUS,
  VIEW_ASPECT,
  pinsFor,
  samePins,
  tapToFraction,
  type CommentPin,
  type ViewerMark,
} from "@/lib/condition-geometry";

export type { ViewerMark };

/**
 * The reference view: the object, and the faults somebody has marked on it.
 *
 * ── THE VIEW IS THE COORDINATE SPACE, NOT THE PHOTOGRAPH ────────────────────
 *
 * A mark is stored as fractions of THIS BOX, whose proportion is fixed
 * (`VIEW_ASPECT`), and the photograph is drawn inside it. That is the whole
 * reason a re-shoot does not move a mark, and it is why the box keeps its shape
 * whether or not there is a picture in it yet — a view with no photograph is
 * still a space a registrar can mark up, and the marks stay put when one
 * arrives. src/db/schema.ts carries the argument beside the columns.
 *
 * ── THE ARITHMETIC IS NOT HERE ──────────────────────────────────────────────
 *
 * src/lib/condition-geometry.ts holds it, for the reason
 * selection-geometry.ts gives about the overlay: vitest runs in node with no
 * jsdom, so anything decided in this file is decided where no test can reach
 * it. What is left here is the listeners, the refs and the paint.
 *
 * That module builds on the EDITOR's geometry rather than repeating it —
 * `pinPoint` for where a number hangs, `pinAnchor` for which part of the box is
 * actually picture, `samePins` for whether a repaint is worth doing. Three of
 * those had no caller before this screen.
 *
 * ── MEASURED, NOT COMPUTED FROM THE MODEL ───────────────────────────────────
 *
 * The box is read with `getBoundingClientRect` rather than assumed from the
 * aspect ratio and the container's width. The same rule the overlay follows:
 * the painted box already carries whatever the layout did to it, and
 * reconstructing it drifts from what the specialist can see.
 */
export function ConditionViewer({
  view,
  label,
  src,
  caption,
  marks,
  selectedId,
  onSelect,
  onAdd,
}: {
  view: string;
  label: string;
  /** The photograph standing for this view, or null while none has been chosen. */
  src: string | null;
  /** One line under the box: what this picture is and when it was taken. */
  caption: string;
  marks: readonly ViewerMark[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /**
   * Fractions of the VIEW, already checked against the picture. Null disables
   * marking — the lifetime view is a reading of examinations that happened, and
   * a new mark there would have no examination to belong to.
   */
  onAdd: ((x: number, y: number) => void) | null;
}): React.ReactElement {
  const frameRef = useRef<HTMLDivElement>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [pins, setPins] = useState<readonly CommentPin[]>([]);
  // A TAP THAT LANDED ON NOTHING SAYS SO. Silently ignoring it is the shape of
  // a control that looks live and is not: the registrar tapped, no ring
  // appeared, and nothing told them why.
  const [missed, setMissed] = useState(false);
  // The ring is a fraction of the VIEW's width, and a ring drawn inside an
  // absolutely-positioned button cannot say that in CSS — a percentage there
  // resolves against the button. So the one measurement is kept and the ring is
  // painted from it, which is also what keeps the ring and `MARK_SAME_WITHIN`
  // talking about the same circle.
  const [frameW, setFrameW] = useState(0);

  const measure = useCallback((): void => {
    const element = frameRef.current;
    if (!element) return;
    const box = element.getBoundingClientRect();
    // The layer IS the frame, so the origin is its own top-left and the
    // conversion is the identity — `toOverlayRect` is still what does it, so
    // that the day this box sits inside something with a border the inset
    // comes from the browser rather than from a number typed here.
    const frame = toOverlayRect(
      { left: 0, top: 0, width: box.width, height: box.height },
      { x: 0, y: 0 },
    );
    setFrameW((previous) => (previous === frame.w ? previous : frame.w));
    const next: CommentPin[] = pinsFor(marks, frame);
    setPins((previous) => (samePins(previous, next) ? previous : next));
  }, [marks]);

  useEffect(() => {
    measure();
    const element = frameRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => measure());
    observer.observe(element);
    return () => observer.disconnect();
  }, [measure]);

  const tap = (event: React.MouseEvent<HTMLDivElement>): void => {
    if (!onAdd) return;
    const element = frameRef.current;
    if (!element) return;
    const box = element.getBoundingClientRect();
    const frame: OverlayRect = { x: 0, y: 0, w: box.width, h: box.height };
    // OUTSIDE THE PICTURE IS NOT A MARK, and the fractions are of the VIEW and
    // not of the picture. Both rules are `tapToFraction`'s, so they are held by
    // a test rather than by this handler.
    const at = tapToFraction(frame, natural, {
      x: event.clientX - box.left,
      y: event.clientY - box.top,
    });
    if (!at) {
      setMissed(true);
      return;
    }
    setMissed(false);
    onAdd(at.x, at.y);
  };

  return (
    <figure className="m-0 flex min-h-0 flex-col">
      <div className="flex justify-center">
        <div
          ref={frameRef}
          onClick={tap}
          // A ROLE-LESS DIV WITH A DOCUMENTED KEYBOARD PATH. Making the whole
          // box a button would announce "reference view, button" and give a
          // keyboard user one target for a two-dimensional gesture, which is
          // not a gesture a keyboard has. The keyboard path to a new mark is
          // the "Add a mark" button beside the list, which places one in the
          // middle of the view for the person to describe and move later —
          // stated here because an absent affordance that is deliberate looks
          // exactly like one that was forgotten.
          className="relative w-full max-w-[420px] border border-rule bg-sunk"
          style={{ aspectRatio: String(VIEW_ASPECT) }}
          data-view={view}
        >
          {src ? (
            /* eslint-disable-next-line @next/next/no-img-element -- the plate
               is a content-addressed byte stream from /api/assets and has no
               known dimensions at build time; the same reason lot-photographs
               uses one. */
            <img
              src={src}
              alt={`Reference view, ${label.toLowerCase()}`}
              onLoad={(event) =>
                setNatural({
                  w: event.currentTarget.naturalWidth,
                  h: event.currentTarget.naturalHeight,
                })
              }
              className="absolute inset-0 h-full w-full object-contain"
            />
          ) : (
            <p className="absolute inset-x-4 top-1/2 -translate-y-1/2 text-center text-[12px] leading-relaxed text-faint">
              No photograph stands for this view yet. Marks can still be placed;
              they are fractions of the view, so they stay where they are put
              when one arrives.
            </p>
          )}

          {marks.map((mark, index) => {
            const pin = pins[index];
            const on = mark.id === selectedId;
            return (
              <span key={mark.id}>
                {/* The ring, on the fault. Open, so the fault is visible
                    through it — a filled disc would hide the thing being
                    reported. */}
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelect(mark.id);
                  }}
                  aria-label={`Mark ${mark.number}${mark.sightings > 1 ? `, seen ${mark.sightings} times` : ""}`}
                  aria-pressed={on}
                  // THE FLOOR IS THE TARGET, NOT THE RING. `--tap` is 44px
                  // under a coarse pointer and the ring is drawn at 7% of the
                  // view — about 29px here — so the pressable box is the token
                  // and the ring inside it is the paint. A target the size of
                  // the drawing would be the control a registrar misses on a
                  // tablet, which is the case the token exists for.
                  className={`absolute flex min-h-[var(--tap)] min-w-[var(--tap)] -translate-x-1/2 -translate-y-1/2 items-center justify-center ${
                    on ? "text-seal" : "text-ink"
                  }`}
                  style={{ left: `${mark.x * 100}%`, top: `${mark.y * 100}%` }}
                >
                  <span
                    aria-hidden="true"
                    className={`block rounded-full border-2 ${on ? "border-seal" : "border-ink"}`}
                    style={{
                      width: `${Math.max(12, MARK_RADIUS * 2 * frameW)}px`,
                      aspectRatio: "1",
                    }}
                  />
                </button>
                {/* The number, just outside the ring — `pinPoint`'s answer,
                    in measured pixels. Absent until the first measure, which
                    is one frame and never a layout the reader sees. */}
                {pin && (
                  <span
                    aria-hidden="true"
                    data-numeric
                    className={`pointer-events-none absolute flex -translate-x-1/2 -translate-y-1/2 items-center gap-0.5 border px-1 text-[10px] font-semibold ${
                      on
                        ? "border-seal bg-seal text-paper"
                        : "border-ruleStrong bg-paper text-ink"
                    }`}
                    style={{ left: `${pin.at.x}px`, top: `${pin.at.y}px` }}
                  >
                    {mark.number}
                    {pin.count > 1 && <span className="font-normal">×{pin.count}</span>}
                  </span>
                )}
              </span>
            );
          })}
        </div>
      </div>
      <figcaption className="mt-2 text-center text-[12px] text-faint">
        {caption}
        {onAdd && !missed && (
          <span className="ml-1 text-muted">Tap the object to mark a fault.</span>
        )}
        {onAdd && missed && (
          <span role="status" aria-live="polite" className="ml-1 text-seal">
            That was beside the picture, not on it — nothing was marked.
          </span>
        )}
      </figcaption>
    </figure>
  );
}
