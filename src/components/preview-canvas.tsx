"use client";

import { startTransition, useCallback, useEffect, useRef, useState } from "react";

import { placePartAction } from "@/app/events/[id]/catalogue/actions";
import { SelectionOverlay } from "@/components/selection-overlay";
import { dragRect, parseContent, subjectRect, type PageFrame } from "@/lib/editor/drag-geometry";
import {
  ATTR,
  clipMarks,
  isDrag,
  PAGE_SELECTOR,
  PART_SELECTOR,
  parsePageFrame,
  placementFrame,
  PLACED_BY_HAND,
  PLACED_SELECTOR,
  ringsFor,
  sameClips,
  type ClipMark,
  type MeasuredPart,
} from "@/lib/editor/overlay-model";
import {
  entryFor,
  record,
  type PlacementEntry,
} from "@/lib/editor/placement-history";
import {
  openBuffers,
  readyToShow,
  show,
  srcFor,
  titleOf,
  type BufferState,
  type Slot,
} from "@/lib/editor/preview-buffer";
import {
  identityFrom,
  sameRings,
  sameSelection,
  selectionKey,
  toOverlayRect,
  type OverlayRect,
  type Point,
  type PreviewSelection,
  type SelectionRing,
} from "@/lib/editor/selection-geometry";
import { logAction } from "@/lib/log/client";

/**
 * The preview, and the pointer layer over it.
 *
 * ── THE EDITOR READS THE CHILD AND WRITES THROUGH THE DATA LAYER ────────────
 *
 * Every rectangle here is measured out of `iframe.contentDocument` with
 * `getBoundingClientRect()`, which is legal because the preview is a
 * same-origin ROUTE with no `sandbox` attribute and no script of its own
 * (ARCHITECTURE.md principle 8). Nothing is written into that document — the
 * one exception is `scrollTop` on the incoming buffer, which is the reader's
 * viewport and not the catalogue; see `swapTo`. A drag moves a RING, the frame
 * goes to the server, and the part moves when the server's answer comes back.
 * "The preview is the catalogue" only stays true if nothing can move a box
 * here that could not also reach the PDF.
 *
 * ── DUCK-TYPED, NEVER `instanceof` ──────────────────────────────────────────
 *
 * A node from the preview realm is not `instanceof Element` in this one, so
 * every element this file touches is described by `ChildEl` below: the members
 * it reads, and nothing about which constructor made it. That check has
 * silently answered false in this product before.
 *
 * ── THE OVERLAY TAKES NO POINTER, SO THE CHILD IS WHERE WE LISTEN ───────────
 *
 * The chrome is `pointer-events: none` (selection-overlay.tsx says what a live
 * layer costs). So pointer and key events are heard on the CHILD document —
 * which is also the only way a shortcut survives focus entering the frame — and
 * a capture layer is mounted in the parent for the LIFE OF A GESTURE and no
 * longer. The capture layer is not there to handle the events; it is there to
 * take the hit test away from the iframe, so a drag that leaves the frame is
 * still reported to this window at all.
 *
 * Both paths feed the same handlers, and both compute the pointer's position
 * from scratch rather than accumulating deltas, so a duplicate event is
 * harmless: the gesture is always a function of where the pointer started and
 * where it is now.
 *
 * ── WHAT IS STATE AND WHAT IS A REF ─────────────────────────────────────────
 *
 * The rings re-measure on every scroll frame of a 43-page flow. Anything a
 * handler reads mid-gesture is a REF, so the handlers never go stale and never
 * force a render; the only state is what has to be painted, and it is replaced
 * only when `sameRings` / `sameClips` say the paint would differ.
 */

/**
 * The members this layer reads off a node in the preview's document.
 *
 * Structural on purpose: see the header. Writing it down also means the compiler
 * checks that nothing here reaches for a member the overlay has no business
 * touching — `innerHTML`, `style`, `remove` — which is the "never write into
 * the preview" rule expressed as a type instead of as a promise.
 */
interface ChildEl {
  getAttribute(name: string): string | null;
  getBoundingClientRect(): { left: number; top: number; width: number; height: number };
  closest(selector: string): ChildEl | null;
  querySelector(selector: string): ChildEl | null;
  readonly scrollWidth: number;
  readonly scrollHeight: number;
  readonly clientWidth: number;
  readonly clientHeight: number;
}

/** What a running gesture needs to remember. Never state — see the header. */
interface Gesture {
  sel: PreviewSelection;
  /** The part's box when the pointer went down, in overlay pixels. */
  start: OverlayRect;
  /** Its page's box, the denominator of the frame this will commit. */
  page: OverlayRect;
  /** Where the pointer went down, in overlay pixels. */
  from: Point;
  /** The frame already stored for this part, for the undo entry. */
  before: PageFrame | null;
  moved: boolean;
}

export function PreviewCanvas({
  eventId,
  catalogueId,
  src,
}: {
  eventId: string;
  /** Null on a sale with no catalogue row yet; nothing there is selectable. */
  catalogueId: string | null;
  /** The preview route, with the version in the query. See ../page.tsx. */
  src: string;
}): React.ReactElement {
  const [buffers, setBuffers] = useState<BufferState>(() => openBuffers(src));
  const [capturing, setCapturing] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [paint, setPaint] = useState<{
    rings: SelectionRing[];
    clips: ClipMark[];
    selection: string | null;
    clipped: boolean;
    placements: number;
  }>({ rings: [], clips: [], selection: null, clipped: false, placements: 0 });

  const container = useRef<HTMLDivElement>(null);
  // TWO REFS RATHER THAN ONE HOLDING A TWO-ELEMENT ARRAY. An array literal
  // handed to `useRef` is a value React's own lint treats as frozen, and so is
  // everything reached through it — which includes the incoming document's
  // scroll position, the one thing this component has to be able to set.
  const frameA = useRef<HTMLIFrameElement | null>(null);
  const frameB = useRef<HTMLIFrameElement | null>(null);
  const frameAt = useCallback(
    (slot: Slot): HTMLIFrameElement | null => (slot === 0 ? frameA.current : frameB.current),
    [],
  );
  const front = useRef<Slot>(0);
  /** Bumped by every frame load, so the listener effect re-binds to the NEW
   *  document — `contentDocument` is replaced by a navigation and React has no
   *  signal for it. */
  const [loaded, setLoaded] = useState(0);

  const selected = useRef<PreviewSelection | null>(null);
  const selectedEl = useRef<ChildEl | null>(null);
  const hovered = useRef<PreviewSelection | null>(null);
  const hoveredEl = useRef<ChildEl | null>(null);
  const live = useRef<OverlayRect | null>(null);
  const gesture = useRef<Gesture | null>(null);
  /** 4b's undo reads this. Recorded now because the frame a drag replaced
   *  exists only in the instant before the write (placement-history.ts). */
  const history = useRef<PlacementEntry[]>([]);
  const frame = useRef(0);

  // `measure` runs from a raf and from listeners that outlive a render, so it
  // reads the front slot from a ref rather than from the closure. Kept in step
  // here as well as at the swap, so a second writer of `buffers.front` could
  // not put the two out of agreement without this noticing.
  useEffect(() => {
    front.current = buffers.front;
  }, [buffers.front]);

  // ── Measuring ─────────────────────────────────────────────────────────────

  const measure = useCallback((): void => {
    const el = frameAt(front.current);
    const doc = el?.contentDocument;
    if (!el || !doc) return;
    // The iframe's CONTENT box relative to the overlay layer's top-left. The
    // layer is `absolute inset-0` over the frame, so the layer's origin is the
    // frame's BORDER box; `clientLeft`/`clientTop` is the browser's own answer
    // for the inset rather than a number copied out of a Tailwind class.
    const origin: Point = { x: el.clientLeft, y: el.clientTop };

    // WHAT IS MEASURED, AND WHY IT IS NOT EVERYTHING. A 43-page flow holds
    // upwards of a thousand parts and raises scroll events continuously;
    // re-reading every box per frame is what makes a preview stutter
    // (canvas-geometry.ts's `currentPageIndex` refuses the same work). Three
    // things need a box: what is selected, what is under the pointer, and the
    // hand-placed parts — which are few by construction, because each one is
    // a row somebody made.
    const parts: MeasuredPart[] = [];
    const seen = new Set<string>();
    const add = (node: ChildEl | null): void => {
      if (!node) return;
      const part = measurePart(node, origin);
      if (!part) return;
      const key = selectionKey(part.sel);
      if (seen.has(key)) return;
      seen.add(key);
      parts.push(part);
    };
    // PLACED FIRST, so it wins the de-duplication. A price list leaves the
    // lifted cell's empty `<td>` behind carrying the same two attributes (the
    // colgroup declares the widths, so a row with one fewer cell shifts every
    // column after it) — two elements, one identity, and the one that shows
    // the ink is the one worth ringing.
    for (const node of Array.from(doc.querySelectorAll(PLACED_SELECTOR))) add(node);
    // THE SELECTION OUTLIVES THE DOCUMENT and the element does not. A commit
    // swaps in a frame holding a freshly derived page, so the node this was
    // pointing at belongs to a document that is on its way to `about:blank` —
    // and measuring it gives a rectangle of zeros, which paints a ring in the
    // corner of the canvas around nothing. The identity is what survives
    // (principle 1), so it is re-found rather than remembered.
    if (selected.current && !selectedEl.current) {
      selectedEl.current = findPart(doc, selected.current);
    }
    add(selectedEl.current);
    add(hoveredEl.current);

    const rings = ringsFor({
      parts,
      selected: selected.current,
      hovered: hovered.current,
      live: live.current,
    });
    const clips = clipMarks(parts);
    const selection = selected.current ? selectionKey(selected.current) : null;
    const clipped = selection !== null && clips.some((c) => c.key === `${selection}|clip`);
    setPaint((prev) =>
      sameRings(prev.rings, rings) &&
      sameClips(prev.clips, clips) &&
      prev.selection === selection &&
      prev.clipped === clipped &&
      prev.placements === history.current.length
        ? prev
        : { rings, clips, selection, clipped, placements: history.current.length },
    );
  }, [frameAt]);

  /** One measurement per painted frame, however many events asked for it. */
  const schedule = useCallback((): void => {
    if (frame.current !== 0) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      measure();
    });
  }, [measure]);

  useEffect(
    () => () => {
      if (frame.current !== 0) cancelAnimationFrame(frame.current);
    },
    [],
  );

  // ── The two buffers ───────────────────────────────────────────────────────

  /**
   * A frame has finished loading. Show it, if it is the one being prepared.
   *
   * NO EFFECT DRIVES THIS. Both `src` attributes are a pure function of the
   * state and the wanted document (preview-buffer.ts's `srcFor`), so a change
   * of prop navigates the back frame during the ordinary render and the only
   * thing left to do is react to its `load` — which is an event, from an
   * external system, which is what effects and event handlers are actually
   * for. The first version held both URLs in state and filled them from an
   * effect, and React's own lint refused it for exactly the reason it was
   * wrong: the cascade could see a frame carrying the wanted URL and conclude
   * it had painted it.
   *
   * THE SCROLL IS THE ONE THING WRITTEN INTO A PREVIEW DOCUMENT, and it is the
   * reader's viewport rather than the catalogue: no box moves and no markup
   * changes. The alternative is a reader thrown to page 1 of a 43-page flow by
   * every edit they make. The outgoing frame is only READ.
   */
  const onFrameLoad = useCallback(
    (slot: Slot): void => {
      // Every load, including the blank one: the listener effect binds to
      // `contentDocument`, and a navigation replaces it.
      setLoaded((n) => n + 1);
      const wanted = srcFor(buffers, slot, src);
      const here = frameAt(slot);
      const ready = readyToShow(
        buffers,
        slot,
        wanted,
        new URL(wanted, window.location.href).href,
        here?.contentWindow?.location.href,
      );
      if (!ready) {
        // The showing frame reloaded on its own — somebody pressed refresh —
        // so whatever the last gesture left painted is about a document that
        // no longer exists.
        if (slot === buffers.front) {
          live.current = null;
          selectedEl.current = null;
          hoveredEl.current = null;
        }
        schedule();
        return;
      }
      const from = frameAt(buffers.front)?.contentDocument?.scrollingElement;
      const into = here?.contentDocument?.scrollingElement;
      if (from && into) into.scrollTop = from.scrollTop;
      front.current = slot;
      // The ring has been standing where the pointer left it since the commit;
      // this is the frame in which the ink arrives underneath it. The element
      // references go with it — see `measure`, which re-finds the selection by
      // identity in the document that is now showing.
      live.current = null;
      selectedEl.current = null;
      hovered.current = null;
      hoveredEl.current = null;
      setBuffers(show(buffers, slot, wanted));
      schedule();
    },
    [buffers, frameAt, schedule, src],
  );

  // ── The gesture ───────────────────────────────────────────────────────────

  const clearSelection = useCallback((): void => {
    if (!selected.current) return;
    selected.current = null;
    selectedEl.current = null;
    setNote(null);
    schedule();
  }, [schedule]);

  const commit = useCallback(
    (g: Gesture, placed: PageFrame): void => {
      const entry = entryFor(g.sel, g.before, placed, Date.now());
      // Counted before the round trip, and counted whether or not it lands:
      // principle 5 is about what a person DID, and a refused placement is a
      // gesture the experiment has to see.
      logAction(
        "catalogue.place",
        { lot: g.sel.lotId, field: g.sel.field, frame: placed, first: g.before === null },
        catalogueId,
      );
      startTransition(async () => {
        const result = await placePartAction(eventId, g.sel.lotId, g.sel.field, placed);
        if (!result.ok) {
          live.current = null;
          setNote(result.message);
          schedule();
          return;
        }
        if (entry) history.current = record(history.current, entry);
        setNote(null);
        // `live` is deliberately left standing. The document in the frame is
        // still the old one until the back buffer has loaded, so clearing the
        // ring now would snap it back to where the part used to be and then
        // forward again — which reads as a drag that did not take.
        schedule();
      });
    },
    [catalogueId, eventId, schedule],
  );

  const onMove = useCallback(
    (at: Point): void => {
      const g = gesture.current;
      if (!g) return;
      const dx = at.x - g.from.x;
      const dy = at.y - g.from.y;
      if (!g.moved && !isDrag(dx, dy)) return;
      g.moved = true;
      live.current = dragRect(g.start, "move", dx, dy);
      schedule();
    },
    [schedule],
  );

  const onUp = useCallback(
    (at: Point): void => {
      const g = gesture.current;
      gesture.current = null;
      setCapturing(false);
      if (!g) return;
      const dx = at.x - g.from.x;
      const dy = at.y - g.from.y;
      // A press that came back to where it started is a click, not a drag that
      // happened to end at zero — so nothing is written for it.
      if (!g.moved || !isDrag(dx, dy)) {
        live.current = null;
        schedule();
        return;
      }
      const placed = placementFrame(g.start, g.page, dx, dy);
      if (!placed) {
        live.current = null;
        setNote("That would put the part off the page, so nothing was saved.");
        schedule();
        return;
      }
      commit(g, placed);
    },
    [commit, schedule],
  );

  const cancelGesture = useCallback((): void => {
    if (!gesture.current) return;
    gesture.current = null;
    live.current = null;
    setCapturing(false);
    schedule();
  }, [schedule]);

  // ── The keyboard ──────────────────────────────────────────────────────────

  /**
   * Escape, and nothing else in this slice.
   *
   * BOUND ON THE CHILD AS WELL AS ON THE WINDOW, which is the whole reason it
   * is a callback rather than two handlers: a shortcut bound only to the parent
   * window dies the moment the pointer — and with it the focus — enters the
   * iframe, which is where this editor's work happens.
   *
   * THE ARROW KEYS ARE NOT CLAIMED. `nudgeDelta` exists and is wired to
   * nothing, and src/components/lot-steps.tsx already owns a bare arrow for
   * stepping between the lots of a sale. What a bare arrow means when a part
   * is selected is the nudge tranche's decision — lot-steps.tsx says so in as
   * many words — and taking it here by accident would break the stepper on the
   * screen where it is used most.
   */
  const onKey = useCallback(
    (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      // Escape puts away whatever is in the way, in the order a person would
      // expect: the gesture first, then the message, then the selection.
      setNote(null);
      if (gesture.current) {
        cancelGesture();
        event.preventDefault();
        return;
      }
      if (!selected.current) return;
      clearSelection();
      event.preventDefault();
    },
    [cancelGesture, clearSelection],
  );

  useEffect(() => {
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onKey]);

  // ── Listening on the child ────────────────────────────────────────────────

  useEffect(() => {
    const el = frameAt(buffers.front);
    const doc = el?.contentDocument;
    if (!el || !doc) return;
    const origin = (): Point => ({ x: el.clientLeft, y: el.clientTop });
    const childPoint = (event: PointerEvent): Point => {
      const o = origin();
      return { x: event.clientX + o.x, y: event.clientY + o.y };
    };

    const onPointerDown = (event: PointerEvent): void => {
      // The primary button only. A right click is a context menu and a middle
      // click is a paste on some platforms; neither is a placement.
      if (event.button !== 0) return;
      const node = partAt(event.target);
      if (!node) {
        clearSelection();
        return;
      }
      const part = measurePart(node, origin());
      if (!part) {
        clearSelection();
        return;
      }
      // Refuse the browser's default for a press this editor has claimed —
      // otherwise the child begins a text selection and the drag paints a blue
      // smear across the catalogue. A refusal is not a write: nothing about
      // the document changes.
      event.preventDefault();
      selected.current = part.sel;
      selectedEl.current = node;
      setNote(null);
      gesture.current = {
        sel: part.sel,
        start: part.rect,
        page: part.page,
        from: childPoint(event),
        before: parsePageFrame(node.getAttribute(ATTR.frame)),
        moved: false,
      };
      setCapturing(true);
      logAction(
        "catalogue.select",
        { lot: part.sel.lotId, field: part.sel.field, placed: part.placed },
        catalogueId,
      );
      schedule();
    };

    const onPointerMove = (event: PointerEvent): void => {
      if (gesture.current) {
        onMove(childPoint(event));
        return;
      }
      const node = partAt(event.target);
      const next = node
        ? identityFrom(node.getAttribute(ATTR.lot), node.getAttribute(ATTR.field))
        : null;
      // `sameSelection` is false when either side is null, so the both-null
      // case — the pointer crossing blank paper — is asked separately or the
      // overlay would re-measure on every move over the margin.
      if (next === null && hovered.current === null) return;
      if (sameSelection(next, hovered.current)) return;
      hovered.current = next;
      hoveredEl.current = node;
      schedule();
    };

    const onPointerUp = (event: PointerEvent): void => {
      if (gesture.current) onUp(childPoint(event));
    };

    const onLeave = (): void => {
      if (gesture.current || hovered.current === null) return;
      hovered.current = null;
      hoveredEl.current = null;
      schedule();
    };

    doc.addEventListener("pointerdown", onPointerDown);
    doc.addEventListener("pointermove", onPointerMove);
    doc.addEventListener("pointerup", onPointerUp);
    doc.addEventListener("pointerleave", onLeave);
    doc.addEventListener("keydown", onKey);
    // CAPTURE, because a scroll inside the preview is raised on the scrolling
    // element and does not bubble to the document.
    doc.addEventListener("scroll", schedule, { passive: true, capture: true });
    // The document may already be laid out by the time this binds — a
    // re-render with no navigation — so measure once rather than waiting for
    // an event that has been and gone.
    schedule();
    return () => {
      doc.removeEventListener("pointerdown", onPointerDown);
      doc.removeEventListener("pointermove", onPointerMove);
      doc.removeEventListener("pointerup", onPointerUp);
      doc.removeEventListener("pointerleave", onLeave);
      doc.removeEventListener("keydown", onKey);
      doc.removeEventListener("scroll", schedule, { capture: true });
    };
    // `loaded` is the dependency that MATTERS and is read nowhere in the body:
    // a navigation replaces `contentDocument`, React has no signal for it, and
    // without this the listeners stay on the document that has gone.
  }, [
    buffers.front,
    loaded,
    catalogueId,
    clearSelection,
    frameAt,
    onKey,
    onMove,
    onUp,
    schedule,
  ]);

  // ── The parent's half of a gesture ────────────────────────────────────────

  useEffect(() => {
    if (!capturing) return;
    const at = (event: PointerEvent): Point => {
      const box = container.current?.getBoundingClientRect();
      return { x: event.clientX - (box?.left ?? 0), y: event.clientY - (box?.top ?? 0) };
    };
    const move = (event: PointerEvent): void => onMove(at(event));
    const up = (event: PointerEvent): void => onUp(at(event));
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancelGesture);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancelGesture);
    };
  }, [capturing, cancelGesture, onMove, onUp]);

  // ── The frame's own size ──────────────────────────────────────────────────

  useEffect(() => {
    const box = container.current;
    if (!box || typeof ResizeObserver === "undefined") return;
    // Every ring is in the child's pixels, and the page is sized from the
    // frame's height — so putting the lots panel away re-lays the whole
    // document out and every measured box is wrong until this fires.
    const observer = new ResizeObserver(schedule);
    observer.observe(box);
    return () => observer.disconnect();
  }, [schedule]);

  // ── Paint ─────────────────────────────────────────────────────────────────

  return (
    // ISOLATED, and that is a defect avoided rather than a flourish. The
    // canvas stacks three things of its own — two frames, the chrome, and a
    // capture layer — while the editor page puts the blank sheet's call to
    // action on the same canvas as a LATER SIBLING with no z-index of its own.
    // Without a stacking context here, `z-[1]` on a frame paints over that
    // bar, and the one action a new sale offers disappears behind the preview.
    <div ref={container} className="isolate absolute inset-0">
      {([0, 1] as const).map((slot) => (
        <iframe
          key={slot}
          ref={slot === 0 ? frameA : frameB}
          /* NO `sandbox` ATTRIBUTE, on either frame. The document is inert
             because of its Content-Security-Policy, which carries no
             script-src; a sandbox without allow-scripts stops WebKit
             dispatching DOM events into the frame at all, which is the defect
             that killed the predecessor's editing layer in Safari for a year
             while Chromium-only testing reported everything green
             (ARCHITECTURE.md principle 8). */
          title={titleOf(buffers, slot)}
          src={srcFor(buffers, slot, src)}
          onLoad={() => onFrameLoad(slot)}
          /* LAID OUT WHETHER OR NOT IT IS SHOWING, and never `display: none`:
             a hidden frame lays out at a zero viewport, and this renderer's
             page and type scale are both functions of it, so the swap would
             show a document laid out for a window that does not exist
             (preview-buffer.ts). `aria-hidden` and `pointer-events-none` keep
             the one nobody is reading out of the way of both the pointer and
             the accessibility tree. */
          aria-hidden={slot === buffers.front ? undefined : true}
          className={
            slot === buffers.front
              ? "absolute inset-0 z-[1] h-full w-full"
              : "pointer-events-none absolute inset-0 z-0 h-full w-full opacity-0"
          }
        />
      ))}

      {/* THE WRAPPER TAKES NO POINTER EITHER. It exists only to stack the
          chrome above both frames, and a bare positioned div with no
          background still hit-tests — which would make the whole canvas a
          dead zone and stop the wheel scrolling a 43-page flow, the exact
          defect the overlay is arranged to avoid, reintroduced by the
          element that arranges it. */}
      <div className="pointer-events-none absolute inset-0 z-[2]">
        <SelectionOverlay
          rings={paint.rings}
          clips={paint.clips}
          selection={paint.selection}
          placements={paint.placements}
          note={
            note ??
            (paint.clipped
              ? "This box is too small for its text, so the rest is cut. A placed part has no fade to say so, on the screen or on paper — give it more room, or shorten the field."
              : null)
          }
        />
      </div>

      {capturing && (
        /* MOUNTED FOR THE LIFE OF THE GESTURE AND NO LONGER. It handles
           nothing — the listeners are on the window — and exists to take the
           hit test away from the iframe, so a pointer that leaves the frame
           mid-drag is still reported to this document. A layer that stayed
           would be the dead zone the whole overlay is arranged to avoid. */
        <div data-capture="" className="absolute inset-0 z-[3] cursor-grabbing" />
      )}
    </div>
  );
}

/** The nearest thing an override could be written against, or null. */
function partAt(target: EventTarget | null): ChildEl | null {
  const node = target as { closest?: (selector: string) => ChildEl | null } | null;
  return node?.closest?.(PART_SELECTOR) ?? null;
}

/**
 * Find a (lot, field) in a document, preferring the part that shows the ink.
 *
 * SCANNED AND COMPARED rather than asked for with an attribute selector. A
 * field key is a column name the HOUSE chose — it arrives from their
 * spreadsheet and is routinely Chinese, and may hold a space, a quote or a
 * bracket — so `[data-field="${key}"]` would need CSS escaping that the
 * identity itself does not, and a selector that throws on one customer's
 * column is a selector that works right up until it is in front of them.
 *
 * The placed element wins for the reason `measure` de-duplicates in that
 * order: a lifted table cell leaves its empty `<td>` behind wearing the same
 * two attributes.
 */
function findPart(doc: Document, sel: PreviewSelection): ChildEl | null {
  let fallback: ChildEl | null = null;
  for (const node of Array.from(doc.querySelectorAll(PART_SELECTOR))) {
    if (node.getAttribute(ATTR.lot) !== sel.lotId) continue;
    if (node.getAttribute(ATTR.field) !== sel.field) continue;
    if (node.getAttribute(ATTR.placedBy) === PLACED_BY_HAND) return node;
    fallback ??= node;
  }
  return fallback;
}

/**
 * One painted part, in the overlay's coordinates.
 *
 * NOTHING IS RECONSTRUCTED. The box is the browser's, the page is the
 * browser's, and the identity is two attributes the renderer publishes. A
 * frame COULD be turned back into a rectangle with (page × frame) and no DOM
 * at all — and it would be wrong, because the painted box already carries CJK
 * line wrapping, a plate's object-fit and the fluid type scale resolved
 * against the page this document was actually laid out at.
 */
function measurePart(node: ChildEl, origin: Point): MeasuredPart | null {
  const sel = identityFrom(node.getAttribute(ATTR.lot), node.getAttribute(ATTR.field));
  if (!sel) return null;
  const page = node.closest(PAGE_SELECTOR);
  // A part with no page is not on the paper — which today means a document
  // that has not laid out. There is nothing to be a fraction OF, so there is
  // nothing to commit and nothing to ring.
  if (!page) return null;
  const rect = toOverlayRect(childRect(node), origin);
  const img = node.querySelector("img");
  return {
    sel,
    rect,
    page: toOverlayRect(childRect(page), origin),
    placed: node.getAttribute(ATTR.placedBy) === PLACED_BY_HAND,
    // The element box is the FILE and the frame is the reserved area, so
    // neither on its own is the picture. The renderer publishes no subject box
    // yet, so `parseContent` answers "the whole picture" and this is the
    // `<img>`'s own box — which for an object-fit portrait in a landscape
    // plate is genuinely not the frame.
    picture: img ? subjectRect(toOverlayRect(childRect(img), origin), parseContent(node.getAttribute(ATTR.content))) : null,
    fit: {
      scrollW: node.scrollWidth,
      scrollH: node.scrollHeight,
      clientW: node.clientWidth,
      clientH: node.clientHeight,
    },
  };
}

/** `getBoundingClientRect`, reduced to the four numbers `toOverlayRect` reads. */
function childRect(node: ChildEl): { left: number; top: number; width: number; height: number } {
  const r = node.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}
