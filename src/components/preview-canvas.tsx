"use client";

import { startTransition, useCallback, useEffect, useRef, useState } from "react";

import { placePartAction, restorePartFrameAction } from "@/app/events/[id]/catalogue/actions";
import { SelectionOverlay } from "@/components/selection-overlay";
import {
  SelectionToolbar,
  TOOLBAR_BAND_PX,
  TOOLBAR_FALLBACK,
  TOOLBAR_REACH_PX,
} from "@/components/selection-toolbar";
import { toolbarSpot, type ToolbarSide } from "@/lib/editor/canvas-geometry";
import {
  dragRect,
  guidesFor,
  nudgeDelta,
  parseContent,
  snapDelta,
  subjectRect,
  HANDLE_CURSOR,
  type DragMode,
  type Guide,
  type PageFrame,
  type SnapContext,
} from "@/lib/editor/drag-geometry";
import {
  ATTR,
  clipMarks,
  gestureFrame,
  handlesFor,
  overlapMarks,
  isDrag,
  pressMode,
  snapContext,
  HANDLE_HIT_PX,
  PAGE_SELECTOR,
  PART_SELECTOR,
  parsePageFrame,
  PLACED_BY_HAND,
  PLACED_SELECTOR,
  ringsFor,
  sameClips,
  sameGuides,
  sameOverlaps,
  type ClipMark,
  type OverlapMark,
  type MeasuredPart,
  type PaintedHandle,
} from "@/lib/editor/overlay-model";
import {
  dropLast,
  entryFor,
  forget,
  last,
  record,
  stillApplies,
  undoPatch,
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
  verticalClearance,
  type OverlayRect,
  type Point,
  type PreviewSelection,
  type SelectionRing,
} from "@/lib/editor/selection-geometry";
import { isTyping } from "@/lib/keys";
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
 *
 * ── WHAT THIS LAYER OFFERS, AND THE ONE THING IT DOES NOT ───────────────────
 *
 * Select, drag, resize on eight handles, snap with guides, nudge with the
 * arrows, undo the sitting's last placement, reset a part to the engine. Every
 * decision any of those makes is a tested function in src/lib/editor; what is
 * here is the listeners, the refs and the paint.
 *
 * THERE IS NO ZOOM AND NO SPREAD, and that is a refusal with a measurement
 * behind it rather than a thing not got to. Both need the canvas to scale the
 * frame with a transform, and this renderer's page size and type scale are both
 * functions of the frame's own viewport HEIGHT — so scaling it cancels the zoom
 * at fit:page and re-runs CJK line breaking at both fits. The arithmetic, the
 * two `src/lib/render/html.ts` lines that cause it, the alternatives that were
 * worked through, and what would unblock it are in src/lib/editor/canvas-geometry.ts's
 * header. Everything this file hands `toolbarSpot` is therefore already in
 * screen pixels, and the zoom argument is a literal 1.
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
  /**
   * The parts of one page, for the three questions that are about a SHEET
   * rather than about an element: what overlaps, what a gesture may align to,
   * and where there is room for a bar. `ArrayLike` rather than `NodeListOf`
   * because this type describes members and not constructors — see the header.
   */
  querySelectorAll(selector: string): ArrayLike<ChildEl>;
  readonly scrollWidth: number;
  readonly scrollHeight: number;
  readonly clientWidth: number;
  readonly clientHeight: number;
}

/** What a running gesture needs to remember. Never state — see the header. */
interface Gesture {
  sel: PreviewSelection;
  /**
   * Move, or one of the eight handles. Decided once, at the press, by
   * `pressMode` — never re-derived mid-gesture from where the pointer now is,
   * which would turn a drag into a resize the moment the hand passed over the
   * box's own corner.
   */
  mode: DragMode;
  /** The part's box when the pointer went down, in overlay pixels. */
  start: OverlayRect;
  /** Its page's box, the denominator of the frame this will commit. */
  page: OverlayRect;
  /**
   * What this gesture may align to, captured ONCE at the press.
   *
   * Nothing in the document moves during a gesture — the only box that changes
   * is the one being dragged, and it is deliberately not in the list — so
   * rebuilding this per pointermove would re-measure a page of boxes sixty
   * times a second to get the same answer (`snapContext` says what is in it).
   */
  snap: SnapContext;
  /** Where the pointer went down, in overlay pixels. */
  from: Point;
  /** The frame already stored for this part, for the undo entry. */
  before: PageFrame | null;
  /**
   * This gesture absorbed an arrow run that had not been saved yet, so `start`
   * is where the KEYS left the box rather than where the ink is. It matters at
   * the release: a press that turns out to be a click still has to save the
   * arrows, or a specialist who nudged a part and then tapped it would watch
   * their work vanish with nothing to undo.
   */
  carried: boolean;
  moved: boolean;
}

/**
 * A run of arrow presses, before it is saved.
 *
 * ── WHY A NUDGE IS NOT A PLACEMENT PER PRESS ────────────────────────────────
 *
 * One POST per keypress would re-derive the whole document and reload a preview
 * for each of the ten presses it takes to move something a centimetre — ten
 * round trips, ten frame swaps, and a box that lurches rather than moves. The
 * ring follows the key immediately and the save follows the PAUSE, which is the
 * same bargain a drag already makes: the rectangle is live while the hand is on
 * it, and one commit happens when the hand comes off.
 *
 * `before` is the frame at the start of the RUN, not of the press, so ten
 * presses are one undo entry — the thing a person did was move the part, once,
 * by ten pixels.
 */
interface Nudge {
  sel: PreviewSelection;
  rect: OverlayRect;
  page: OverlayRect;
  before: PageFrame | null;
}

/**
 * How long the arrows keep accumulating before the nudge is saved, in ms.
 *
 * 450 is the predecessor's and it is a hand's number rather than a machine's:
 * long enough that a deliberate run of presses at a comfortable repeat rate is
 * one save, short enough that a specialist who has stopped does not wonder
 * whether it took. Re-measurable by pressing an arrow and watching the override
 * count in the header: it must rise once per pause, not once per press.
 */
const NUDGE_COMMIT_MS = 450;

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
  /** The mode of the running gesture, or null. Drives the capture layer. */
  const [capturing, setCapturing] = useState<DragMode | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [paint, setPaint] = useState<{
    rings: SelectionRing[];
    handles: PaintedHandle[];
    guides: Guide[];
    clips: ClipMark[];
    overlaps: OverlapMark[];
    selection: string | null;
    /** The selected part's field and placedness, for the bar. Null when none. */
    subject: { field: string; placed: boolean } | null;
    toolbar: { x: number; y: number; side: ToolbarSide } | null;
    clipped: boolean;
    placements: number;
  }>({
    rings: [],
    handles: [],
    guides: [],
    clips: [],
    overlaps: [],
    selection: null,
    subject: null,
    toolbar: null,
    clipped: false,
    placements: 0,
  });

  const container = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
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
  /** The alignments the running gesture has found. Painted; never snapped from
   *  — `guidesFor` recomputes them off the FINAL rectangle so a guide cannot
   *  claim an alignment the minimum-size clamp overrode. */
  const guides = useRef<Guide[]>([]);
  /** The arrow run in progress, and the timer that will save it. */
  const nudge = useRef<Nudge | null>(null);
  const nudgeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * Every part on the pages that matter, from the last measurement.
   *
   * Kept so a gesture can build its snap context at the PRESS without a second
   * scan of the document — `measure` has already walked those pages for the
   * overlap marks and the toolbar's clearance, and walking them again in the
   * pointerdown handler would be the same work at the one moment the hand is
   * waiting for the screen.
   */
  const neighbours = useRef<MeasuredPart[]>([]);
  /** Recorded at the commit, because the frame a drag replaced exists only in
   *  the instant before the write (placement-history.ts). */
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

    const selectedPart =
      selected.current === null
        ? null
        : (parts.find((p) => sameSelection(p.sel, selected.current)) ?? null);
    const rings = ringsFor({
      parts,
      selected: selected.current,
      hovered: hovered.current,
      live: live.current,
    });
    const clips = clipMarks(parts);

    // ── WHAT IS UNDERNEATH IS NOT IN `parts`, AND THAT IS THE WHOLE PROBLEM ──
    //
    // `parts` above is the placed parts, the selection and the hover, for the
    // reason written there: measuring a thousand boxes per frame is what makes
    // a preview stutter. Overlap asks a different question — not "where is the
    // thing I am holding" but "whose ink is under it" — and the answer is
    // never in that list. Measured while building this: a placed title landing
    // exactly on a neighbour's title, same x, same y, same width to the pixel,
    // reported nought overlaps, because the neighbour had never been looked at.
    //
    // So the neighbours are collected PER PAGE, and only for the pages that
    // carry a placement. That bounds it twice over: a page holds at most the
    // density times the field count — five fields at nine-up is forty-five —
    // and a document with no placement, which is nearly all of them, measures
    // nothing extra at all. The cost is paid by the person who made the frame.
    //
    // ── AND THE SAME SCAN ANSWERS TWO MORE QUESTIONS SINCE 4b ───────────────
    //
    // Snapping asks "what may this gesture align to" and the floating toolbar
    // asks "where on this page is there no ink", and both are the same list of
    // boxes: everything painted on the sheets that matter. So the scan is
    // widened to include the SELECTION's page — one more page, and only while
    // something is selected — rather than run three times over the same nodes.
    const placedNodes: ChildEl[] = Array.from(doc.querySelectorAll(PLACED_SELECTOR));
    const pages = new Set<ChildEl>();
    for (const node of placedNodes) {
      const owner = node.closest(PAGE_SELECTOR);
      if (owner) pages.add(owner);
    }
    const selectedPage = selectedEl.current?.closest(PAGE_SELECTOR) ?? null;
    if (selectedPage) pages.add(selectedPage);
    const near = partsOn(pages, origin);
    neighbours.current = near;
    // Only the pages that carry a placement can produce an overlap, and `near`
    // may now hold one more page than that — passing the lot would be asking a
    // question about a sheet nobody has touched.
    const overlaps = placedNodes.length > 0 ? overlapMarks(near) : [];

    // ── The handles, and where the bar may stand ─────────────────────────────
    //
    // THE HANDLES FOLLOW THE LIVE RECTANGLE and the BAR DOES NOT EXIST while a
    // gesture runs. The grips are part of the thing being dragged — leaving
    // them on the resting box would leave the corner the hand is holding behind
    // on the page — whereas a bar under the pointer mid-gesture is a patch of
    // dead glass exactly where the hand is, and it would be pointing at a
    // rectangle that is about to be replaced by the server's answer anyway.
    const dragging = live.current !== null;
    const handles = handlesFor(live.current ?? selectedPart?.rect ?? null);
    const box = container.current?.getBoundingClientRect();
    let toolbar: { x: number; y: number; side: ToolbarSide } | null = null;
    if (selectedPart && !dragging && box && box.width > 0 && box.height > 0) {
      const size = bar.current?.getBoundingClientRect();
      // WHAT THE BAR ACTUALLY IS, when there is one to measure. Its width
      // depends on which buttons this selection offers and its height on which
      // pointer is attached (`--tap`), so a constant would place the first
      // correctly and every other kind wrongly (selection-toolbar.tsx).
      const toolbarSize =
        size && size.width > 0 ? { w: size.width, h: size.height } : TOOLBAR_FALLBACK;
      const clear = verticalClearance(
        selectedPart.rect,
        near
          .filter(
            (p) =>
              // The selection is not its own neighbour — a box always covers
              // itself, and counting it would report no room on either side of
              // everything.
              !sameSelection(p.sel, selectedPart.sel) &&
              // AND ONLY THIS SHEET. `near` holds every page that carries a
              // placement, not just this one, and the flow stacks pages
              // vertically — so a part two sheets down with overlapping x
              // reads as something standing directly below the selection.
              // `bounds` clips the ANSWER to the page but not the INPUT: an
              // out-of-page blocker arrives as an inverted interval, which the
              // sweep happens to treat as a huge clear gap. Right answer,
              // wrong reason, and the next change to the sweep would break it
              // silently. Compared by the page's own box, for `overlapMarks`'
              // reason: this layer measures boxes and never reads child ids.
              p.page.x === selectedPart.page.x &&
              p.page.y === selectedPart.page.y,
          )
          .map((p) => p.rect),
        { top: selectedPart.page.y, bottom: selectedPart.page.y + selectedPart.page.h },
        TOOLBAR_BAND_PX,
        TOOLBAR_REACH_PX,
      );
      toolbar = toolbarSpot(
        { ...selectedPart.rect, clear },
        // ONE, AND IT IS NOT A PLACEHOLDER. This canvas applies no transform:
        // every rectangle above is already in the overlay's own screen pixels,
        // so the scale between the page's coordinates and the bar's is the
        // identity. See the note at the foot of this file on why the zoom half
        // of canvas-geometry.ts is still unwired.
        1,
        {
          w: box.width,
          h: box.height,
          // No horizontal pan either, for the same reason.
          scrollLeft: 0,
          // THE FOOT OF THE CANVAS IS SPOKEN FOR. The overlay's note and the
          // blank sheet's call to action both stand at `bottom-6`
          // (selection-overlay.tsx, catalogue/page.tsx), so a bar that pinned
          // itself to the bottom edge would land on whichever of them was
          // showing — the collision `CanvasView.reserveBottom` exists for,
          // found by photograph in the predecessor. 24px of offset plus a row
          // of about the same height as this bar.
          reserveBottom: 24 + toolbarSize.h,
        },
        toolbarSize,
      );
    }

    const selection = selected.current ? selectionKey(selected.current) : null;
    const clipped = selection !== null && clips.some((c) => c.key === `${selection}|clip`);
    const subject = selectedPart
      ? { field: selectedPart.sel.field, placed: selectedPart.placed }
      : null;
    const nextGuides = guides.current;
    setPaint((prev) =>
      sameRings(prev.rings, rings) &&
      sameClips(prev.clips, clips) &&
      sameOverlaps(prev.overlaps, overlaps) &&
      sameGuides(prev.guides, nextGuides) &&
      sameHandles(prev.handles, handles) &&
      sameSpot(prev.toolbar, toolbar) &&
      prev.selection === selection &&
      prev.subject?.field === subject?.field &&
      prev.subject?.placed === subject?.placed &&
      prev.clipped === clipped &&
      prev.placements === history.current.length
        ? prev
        : {
            rings,
            handles,
            guides: nextGuides,
            clips,
            overlaps,
            selection,
            subject,
            toolbar,
            clipped,
            placements: history.current.length,
          },
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

  /**
   * Send one frame, and remember what it replaced.
   *
   * ONE COMMIT FOR THE DRAG, THE RESIZE AND THE NUDGE. The three gestures
   * differ in how the rectangle is arrived at and in nothing after it: the same
   * conversion, the same action, the same undo entry, the same counted row. A
   * second commit path is how the resize would quietly stop recording its
   * `before` — and the missing `before` is the half of undo that cannot be
   * added afterwards (placement-history.ts).
   */
  const commit = useCallback(
    (
      sel: PreviewSelection,
      before: PageFrame | null,
      placed: PageFrame,
      how: "drag" | "resize" | "nudge",
    ): void => {
      const entry = entryFor(sel, before, placed, Date.now());
      // Counted before the round trip, and counted whether or not it lands:
      // principle 5 is about what a person DID, and a refused placement is a
      // gesture the experiment has to see. `how` is here for the same reason
      // lot-steps.tsx distinguishes a click from a key — whether anybody
      // reaches for the arrows is a question that cannot be asked afterwards.
      logAction(
        "catalogue.place",
        { lot: sel.lotId, field: sel.field, frame: placed, first: before === null, how },
        catalogueId,
      );
      startTransition(async () => {
        const result = await placePartAction(eventId, sel.lotId, sel.field, placed);
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

  /**
   * The rectangle a gesture has reached, with the snap folded in.
   *
   * ONE FUNCTION FOR THE MOVE AND THE RELEASE, which is the point: the snap is
   * computed on the RAW rectangle and folded back into the DELTA, so `dragRect`
   * runs once on the combined number (drag-geometry.ts says why — the
   * minimum-size clamp must not be applied twice with two different answers).
   * If the release recomputed its own delta the committed frame would be the
   * unsnapped one, and the part would jump by up to SNAP_PX at the instant the
   * hand came off it — a small lie, on the gesture whose whole promise is that
   * what you see is what is saved.
   */
  const resolve = useCallback(
    (g: Gesture, at: Point): { dx: number; dy: number; rect: OverlayRect } => {
      let dx = at.x - g.from.x;
      let dy = at.y - g.from.y;
      const raw = dragRect(g.start, g.mode, dx, dy);
      const snap = snapDelta(raw, g.mode, g.snap);
      dx += snap.x;
      dy += snap.y;
      return { dx, dy, rect: dragRect(g.start, g.mode, dx, dy) };
    },
    [],
  );

  const onMove = useCallback(
    (at: Point): void => {
      const g = gesture.current;
      if (!g) return;
      if (!g.moved && !isDrag(at.x - g.from.x, at.y - g.from.y)) return;
      g.moved = true;
      const { rect } = resolve(g, at);
      live.current = rect;
      // FROM THE FINAL RECTANGLE, so a guide cannot claim an alignment the
      // clamp overrode: `guidesFor` draws a line if and only if an edge
      // genuinely coincides with something.
      guides.current = guidesFor(rect, g.mode, g.snap);
      schedule();
    },
    [resolve, schedule],
  );

  const onUp = useCallback(
    (at: Point): void => {
      const g = gesture.current;
      gesture.current = null;
      guides.current = [];
      setCapturing(null);
      if (!g) return;
      const { dx, dy } = resolve(g, at);
      // A press that came back to where it started is a click, not a drag that
      // happened to end at zero — so nothing is written for it. Measured on the
      // RAW travel rather than the snapped one: a snap that pulled the box back
      // onto its own starting edge is still a gesture the hand made, and a
      // hand that did not move is still a click however the snap resolved.
      if (!g.moved || !isDrag(at.x - g.from.x, at.y - g.from.y)) {
        // …unless the click absorbed an unsaved arrow run, in which case the
        // arrows are the gesture and this is where they get saved. `start` is
        // where the keys left the box, so a zero delta is exactly right.
        const held = g.carried ? gestureFrame(g.start, g.page, "move", 0, 0) : null;
        if (held) {
          commit(g.sel, g.before, held, "nudge");
          return;
        }
        live.current = null;
        schedule();
        return;
      }
      const placed = gestureFrame(g.start, g.page, g.mode, dx, dy);
      if (!placed) {
        live.current = null;
        setNote("That would put the part off the page, so nothing was saved.");
        schedule();
        return;
      }
      commit(g.sel, g.before, placed, g.mode === "move" ? "drag" : "resize");
    },
    [commit, resolve, schedule],
  );

  const cancelGesture = useCallback((): void => {
    const g = gesture.current;
    if (!g) return;
    gesture.current = null;
    guides.current = [];
    setCapturing(null);
    // AN ABANDONED DRAG STILL OWES THE ARROWS. Escape means "put this gesture
    // back", and the state it goes back to is where the keys left the box, not
    // where the ink is — so a cancelled drag that had absorbed an arrow run
    // saves the run and keeps its ring, rather than throwing away presses the
    // specialist watched land.
    const held = g.carried ? gestureFrame(g.start, g.page, "move", 0, 0) : null;
    if (held) {
      commit(g.sel, g.before, held, "nudge");
      return;
    }
    live.current = null;
    schedule();
  }, [commit, schedule]);

  // ── Undo, and the reset underneath it ─────────────────────────────────────

  /**
   * Put one part's frame back — to what it was, or to the engine's answer.
   *
   * THE SAME WRITE FOR BOTH BUTTONS. Undo hands in the entry's `before`, Reset
   * hands in null, and `restorePartFrameAction` is one endpoint over one patch
   * (../catalogue/actions.ts). Nothing here decides what "back" means; the
   * caller does, and the caller is the only one who can.
   */
  const restore = useCallback(
    (sel: PreviewSelection, frame: PageFrame | null, how: "undo" | "reset"): void => {
      setBusy(true);
      logAction("catalogue.restore", { lot: sel.lotId, field: sel.field, how }, catalogueId);
      startTransition(async () => {
        const result = await restorePartFrameAction(eventId, sel.lotId, sel.field, frame);
        setBusy(false);
        if (!result.ok) {
          setNote(result.message);
          schedule();
          return;
        }
        history.current =
          how === "undo"
            ? dropLast(history.current)
            : // A reset invalidates this part's entries and only this part's.
              // Leaving them would make the next undo fail verification and
              // clear the whole stack — an afternoon of other lots' history
              // thrown away because one part was handed back to the engine.
              forget(history.current, selectionKey(sel));
        // THE RING IS DROPPED, unlike after a placement. A placement leaves the
        // ring where the hand let go because the ink is about to arrive under
        // it; an undo moves the part somewhere the hand never was, so a ring
        // standing at the old position would be pointing at the state that was
        // just taken back.
        live.current = null;
        setNote(null);
        schedule();
      });
    },
    [catalogueId, eventId, schedule],
  );

  /**
   * Take back the last placement of this sitting.
   *
   * ── IT VERIFIES ITSELF AGAINST THE DOCUMENT BEFORE IT ACTS ──────────────────
   *
   * The stack is in this tab; the truth is in a table that a second tab, a
   * colleague, the lot form or a template change may have moved since. So the
   * entry is held against what the renderer currently publishes for that
   * (lot, field) — `data-page-frame`, the value that was STORED rather than the
   * box that was painted — and a disagreement means this entry is not the last
   * thing that happened to that part.
   *
   * THE WHOLE STACK GOES ON A MISMATCH, not just the top entry. Everything
   * beneath it was recorded against the same assumption and is equally unable
   * to prove itself; keeping them would offer a second undo that is wrong in
   * exactly the same way, one press later. And it SAYS SO, because an undo
   * button that quietly did nothing is the shape of failure a person retries.
   */
  const undo = useCallback((): void => {
    const entry = last(history.current);
    if (!entry) return;
    const doc = frameAt(front.current)?.contentDocument;
    const node = doc ? findPart(doc, { lotId: entry.lotId, field: entry.field }) : null;
    const current = parsePageFrame(node?.getAttribute(ATTR.frame));
    if (!stillApplies(entry, current)) {
      history.current = [];
      setNote(
        "This part has changed since it was placed — somewhere else, or by somebody else — so there is nothing safe to undo. The history for this sitting has been cleared.",
      );
      schedule();
      return;
    }
    restore({ lotId: entry.lotId, field: entry.field }, undoPatch(entry).frame, "undo");
  }, [frameAt, restore, schedule]);

  /** Hand the selected part back to the engine. Principle 9, and the floor
   *  under undo: an in-session stack cannot be the only way out of a placement
   *  made yesterday. */
  const reset = useCallback((): void => {
    const sel = selected.current;
    if (!sel) return;
    restore(sel, null, "reset");
  }, [restore]);

  // ── The keyboard ──────────────────────────────────────────────────────────

  /** Save the run of arrow presses that has just stopped. */
  const saveNudge = useCallback((): void => {
    if (nudgeTimer.current) {
      clearTimeout(nudgeTimer.current);
      nudgeTimer.current = null;
    }
    const held = nudge.current;
    nudge.current = null;
    if (!held) return;
    const placed = gestureFrame(held.rect, held.page, "move", 0, 0);
    if (!placed) {
      live.current = null;
      setNote("That would put the part off the page, so nothing was saved.");
      schedule();
      return;
    }
    commit(held.sel, held.before, placed, "nudge");
  }, [commit, schedule]);

  /**
   * Escape, and the arrows.
   *
   * BOUND ON THE CHILD AS WELL AS ON THE WINDOW, which is the whole reason it
   * is a callback rather than two handlers: a shortcut bound only to the parent
   * window dies the moment the pointer — and with it the focus — enters the
   * iframe, which is where this editor's work happens.
   *
   * ── THE BARE ARROW, DECIDED ─────────────────────────────────────────────────
   *
   * A BARE ARROW MEANS THE SELECTION WHEN THERE IS ONE, AND THE SALE WHEN THERE
   * IS NOT. src/components/lot-steps.tsx steps between the lots of a sale on a
   * bare ← / →, refusing every modifier, so Shift+arrow — the coarse nudge —
   * never collided at all and the fine one always would have. This is that
   * collision resolved, and the rule is the one a direct-manipulation editor
   * has to have: a selection is the specialist saying "this is what I am
   * working on", and a key that moved the page out from under it would be the
   * tool overruling them.
   *
   * THE MECHANISM IS THE CAPTURE PHASE, and it is deliberately not "whichever
   * listener was registered first". Both components listen on `window`; a
   * bubble-phase pair would be ordered by mount order, which is a render
   * detail, and the stepper would win or lose depending on which screen the
   * person came from. This listener is registered with `capture: true`, so it
   * runs before every bubble-phase listener on the window whatever the order,
   * and it calls `preventDefault()` only when it has actually consumed the key.
   * lot-steps.tsx already refuses an event whose default is prevented — so
   * "there is no selection" and "the editor is not on this screen" are the same
   * case there, and the stepper needs no knowledge of this component at all.
   *
   * Both files carry this note; neither is allowed to be the only copy.
   */
  const onKey = useCallback(
    (event: KeyboardEvent): void => {
      if (event.defaultPrevented) return;
      if (event.key === "Escape") {
        // Escape puts away whatever is in the way, in the order a person would
        // expect: the gesture first, then the message, then the selection.
        setNote(null);
        if (gesture.current) {
          cancelGesture();
          event.preventDefault();
          return;
        }
        // A RUN OF ARROWS IS A GESTURE TOO, and Escape ends it the way the
        // pause would rather than throwing it away: the box has been moving on
        // screen for as long as the finger was down, and a key that silently
        // discarded that would be the one unrecoverable thing on this layer.
        if (nudge.current) {
          saveNudge();
          event.preventDefault();
          return;
        }
        if (!selected.current) return;
        clearSelection();
        event.preventDefault();
        return;
      }

      // ctrl/cmd is a browser or system shortcut and alt+arrow is Back and
      // Forward; taking either would step a lot AND navigate away at once.
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const step = nudgeDelta(event.key, event.shiftKey);
      if (!step) return;
      // The shared field guard, not a copy of it (src/lib/keys.ts): an arrow
      // inside the Template select moves the option, not the artwork.
      if (isTyping(event.target)) return;
      const sel = selected.current;
      // NOT OURS — so the stepper has it, and `preventDefault` is not called.
      if (!sel || gesture.current) return;

      // The box the run started from, and the frame it started at. Re-measured
      // rather than remembered across the run, because the document may have
      // been replaced by the commit of the PREVIOUS run.
      const held = nudge.current;
      let from: OverlayRect;
      let page: OverlayRect;
      let before: PageFrame | null;
      if (held && sameSelection(held.sel, sel)) {
        from = held.rect;
        page = held.page;
        before = held.before;
      } else {
        const el = frameAt(front.current);
        const node = selectedEl.current;
        if (!el || !node) return;
        const part = measurePart(node, { x: el.clientLeft, y: el.clientTop });
        if (!part) return;
        from = part.rect;
        page = part.page;
        before = parsePageFrame(node.getAttribute(ATTR.frame));
      }

      // Otherwise the preview scrolls a page while the box moves a pixel.
      event.preventDefault();
      const rect = dragRect(from, "move", step.x, step.y);
      nudge.current = { sel, rect, page, before };
      live.current = rect;
      // NO SNAP ON A NUDGE, and that is the point of the gesture. An arrow is
      // what a specialist reaches for when the snap has already put the box
      // somewhere close and they want it one pixel off that — a snap here would
      // pull it straight back and the key would appear to do nothing.
      guides.current = [];
      schedule();
      if (nudgeTimer.current) clearTimeout(nudgeTimer.current);
      nudgeTimer.current = setTimeout(saveNudge, NUDGE_COMMIT_MS);
    },
    [cancelGesture, clearSelection, frameAt, saveNudge, schedule],
  );

  useEffect(() => {
    // CAPTURE. See the note on `onKey`: this is what settles the bare arrow
    // against src/components/lot-steps.tsx without either component knowing
    // the other exists.
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [onKey]);

  // A run of arrows that was still accumulating when this unmounted is work the
  // specialist did and cannot see; the timer goes, and with it the save.
  useEffect(
    () => () => {
      if (nudgeTimer.current) clearTimeout(nudgeTimer.current);
    },
    [],
  );

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

    /**
     * Begin a gesture on a part that has already been measured.
     *
     * ── A PENDING ARROW RUN IS PART OF THIS GESTURE, NOT A RACE WITH IT ─────
     *
     * A run of arrows moves the RING and leaves the ink where it was until the
     * settle fires (see Nudge). So a hand that nudges a part and then grabs it
     * is holding a box the document does not yet agree about: `part.rect` is
     * measured off the ink and is the position BEFORE the arrows.
     *
     * Starting from the measured box would make the part jump back by the
     * nudge the instant the pointer went down, and the pending timer would
     * then commit that stale rectangle in the middle of the drag — two writes
     * for one continuous manipulation, the second of them wrong.
     *
     * So the run is absorbed: the gesture starts from the rectangle on screen
     * and inherits the run's `before`, and the timer is dropped without
     * committing, because this gesture's own commit is about to supersede it.
     * The whole manipulation is then one undo entry, which is what it was.
     */
    const begin = (part: MeasuredPart, node: ChildEl, mode: DragMode, at: Point): void => {
      const here = origin();
      const held = nudge.current;
      const carried = held && sameSelection(held.sel, part.sel) ? held : null;
      if (carried) {
        if (nudgeTimer.current) clearTimeout(nudgeTimer.current);
        nudgeTimer.current = null;
        nudge.current = null;
      }
      const owner = node.closest(PAGE_SELECTOR);
      // MEASURED AT THE PRESS, not taken from the last paint. `measure` only
      // scans the pages that carry a placement or the selection, so the FIRST
      // gesture of a sitting — a press on a sale nobody has touched, which is
      // every sale once — would otherwise find an empty neighbour list and
      // snap to nothing but the page's own edges. One page, once, at the
      // moment the hand goes down; nothing in the document moves after that,
      // which is why it is captured and not recomputed per pointermove.
      const onPage = owner ? partsOn([owner], here) : [];
      const slot = slotFor(node, part.sel);
      gesture.current = {
        sel: part.sel,
        mode,
        start: carried ? carried.rect : part.rect,
        page: part.page,
        snap: snapContext(
          part.sel,
          part.page,
          // THE ENGINE'S OWN SUGGESTION, when the part is still in it. A part a
          // person has already placed is emitted as a child of `.page` and has
          // no slot to find (src/lib/render/html.ts) — `slotFor` recovers it by
          // lot, and `snapContext` reads a genuinely absent one as the page,
          // which is already a target, rather than as a box at the origin.
          slot ? toOverlayRect(childRect(slot), here) : null,
          onPage,
        ),
        from: at,
        before: carried ? carried.before : parsePageFrame(node.getAttribute(ATTR.frame)),
        carried: carried !== null,
        moved: false,
      };
      setCapturing(mode);
    };

    const onPointerDown = (event: PointerEvent): void => {
      // The primary button only. A right click is a context menu and a middle
      // click is a paste on some platforms; neither is a placement.
      if (event.button !== 0) return;
      const at = childPoint(event);

      // ── THE HANDLES ARE TESTED BEFORE THE DOCUMENT IS ─────────────────────
      //
      // A corner handle is centred ON the corner, so half of it — and the whole
      // of its hit box — hangs OUTSIDE the part. A press there lands on the lot
      // underneath as far as the child document is concerned, and asking the
      // document first would select the neighbour instead of resizing the thing
      // the specialist is holding. So the current selection's own grips are
      // asked first, from the coordinates rather than from the hit test, which
      // is the whole reason `hitHandle` exists (drag-geometry.ts).
      const chosen = selectedEl.current;
      if (chosen && selected.current) {
        const part = measurePart(chosen, origin());
        const mode = part ? pressMode(part.rect, at, HANDLE_HIT_PX) : null;
        // Only a HANDLE short-circuits. A press inside the box is a move, and
        // the ordinary path below already reaches that conclusion — going
        // through it keeps one place that decides what a press selects.
        if (part && mode && mode !== "move") {
          event.preventDefault();
          setNote(null);
          begin(part, chosen, mode, at);
          logAction(
            "catalogue.resize",
            { lot: part.sel.lotId, field: part.sel.field, handle: mode },
            catalogueId,
          );
          schedule();
          return;
        }
      }

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
      // A press elsewhere ends the arrow run that was still accumulating —
      // it is the same "the hand has moved on" the pause means.
      if (nudge.current && !sameSelection(nudge.current.sel, part.sel)) saveNudge();
      selected.current = part.sel;
      selectedEl.current = node;
      setNote(null);
      begin(part, node, "move", at);
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
    saveNudge,
    frameAt,
    onKey,
    onMove,
    onUp,
    schedule,
  ]);

  // ── The parent's half of a gesture ────────────────────────────────────────

  useEffect(() => {
    if (capturing === null) return;
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

  // ── The bar's own size ────────────────────────────────────────────────────
  //
  // THE FIRST FRAME OF A NEW SELECTION IS PLACED WITH A GUESS, and this is what
  // corrects it. `measure` reads the rendered bar's box, so on the pass that
  // first decides to show one there is no bar to read and `TOOLBAR_FALLBACK`
  // stands in. One more measurement after the render that mounted it is what
  // replaces the guess with the truth — the width depends on which buttons this
  // selection offers and the height on which pointer is attached.
  //
  // Keyed on the SELECTION rather than on the spot, which is what makes it
  // terminate: the corrected measurement changes `paint.toolbar` and not
  // `paint.selection`, so this runs exactly twice per selection and not once
  // per placement of it.
  useEffect(() => {
    schedule();
  }, [paint.selection, schedule]);

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
          handles={paint.handles}
          guides={paint.guides}
          clips={paint.clips}
          overlaps={paint.overlaps}
          selection={paint.selection}
          placements={paint.placements}
          note={
            // THE OVERLAP SPEAKS FIRST. A box cutting its own text costs one
            // field; a part sitting on the next lot costs that lot's line, and
            // the specialist who has to be told about exactly one of the two
            // should be told about the one that spoils somebody else's entry.
            note ??
            (paint.overlaps.length > 0
              ? "This part is over another lot. Nothing is cut — the ink underneath is simply covered, and it will print that way. Move it, or leave it if the spread wants it."
              : paint.clipped
                ? "This box is too small for its text, so the rest is cut. A placed part has no fade to say so, on the screen or on paper — give it more room, or shorten the field."
                : null)
          }
        />
      </div>

      {/* THE BAR IS THE ONE LIVE THING OVER THE PREVIEW, and it is a bar and
          not a layer: the wrapper above is inert, this is a few hundred pixels
          of chrome that exists only while something is selected, and it is
          gone while a gesture runs. Painted after the overlay wrapper at the
          same z, so it stands over the rings and under the capture layer —
          which is what makes a press mid-gesture pass through it. */}
      {paint.toolbar && paint.subject && paint.selection && (
        <div className="pointer-events-none absolute inset-0 z-[2]">
          <SelectionToolbar
            barRef={bar}
            field={paint.subject.field}
            placed={paint.subject.placed}
            side={paint.toolbar.side}
            at={paint.toolbar}
            busy={busy}
            canUndo={paint.placements > 0}
            onUndo={undo}
            onReset={reset}
          />
        </div>
      )}

      {capturing !== null && (
        /* MOUNTED FOR THE LIFE OF THE GESTURE AND NO LONGER. It handles
           nothing — the listeners are on the window — and exists to take the
           hit test away from the iframe, so a pointer that leaves the frame
           mid-drag is still reported to this document. A layer that stayed
           would be the dead zone the whole overlay is arranged to avoid.

           IT IS ALSO THE ONLY PLACE A HANDLE'S CURSOR CAN APPEAR. A cursor
           belongs to the element under the pointer, that element is inside the
           iframe, and this layer may not write into that document — so
           `HANDLE_CURSOR` reaches the screen here, at the moment the grip is
           taken, rather than on hover. `handlesFor` states what that costs. */
        <div
          data-capture=""
          data-capture-mode={capturing}
          className="absolute inset-0 z-[3]"
          style={{
            cursor: capturing === "move" ? "grabbing" : HANDLE_CURSOR[capturing],
          }}
        />
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

/**
 * Every part painted on these sheets, measured once.
 *
 * ── ONE SCAN, THREE QUESTIONS ───────────────────────────────────────────────
 *
 * What overlaps what, what a gesture may align to, and where on the page there
 * is room for a bar are three questions with one answer: the boxes on the
 * sheets that matter. A 43-page flow holds upwards of a thousand parts, so this
 * is deliberately never asked of the whole document — it is asked of the pages
 * that carry a placement, plus the page the selection is on, which is at most
 * the density times the field count each (five fields at nine-up is forty-five).
 *
 * De-duplicated on identity AND placedness: a price list leaves the lifted
 * cell's empty `<td>` behind carrying the same two attributes, so one identity
 * can have two boxes and the placed one is the subject. Both are kept; the
 * same-lot rule in `overlapMarks` is what stops a part being reported as
 * sitting on its own ghost.
 */
function partsOn(pages: Iterable<ChildEl>, origin: Point): MeasuredPart[] {
  const out: MeasuredPart[] = [];
  const seen = new Set<string>();
  for (const owner of pages) {
    for (const node of Array.from(owner.querySelectorAll(PART_SELECTOR))) {
      const measured = measurePart(node, origin);
      if (!measured) continue;
      const key = `${selectionKey(measured.sel)}|${measured.placed ? "p" : "f"}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(measured);
    }
  }
  return out;
}

/** The class the renderer gives an entry — one lot, laid out where the engine
 *  put it (src/lib/render/html.ts). Declared here rather than typed twice. */
const SLOT_SELECTOR = ".slot";

/**
 * The engine's own box for this part's lot, or null.
 *
 * ── WHY IT IS SEARCHED AND NOT ASKED FOR ────────────────────────────────────
 *
 * The obvious `node.closest('.slot')` is right for a part the engine placed and
 * WRONG for the one case that matters: a part somebody has already moved is
 * emitted as a child of `.page`, outside every slot, so `closest` answers null
 * exactly for the parts that get dragged a second time. The slot is still on
 * the page — it is the arrangement the part was lifted out of, and it is worth
 * aligning back to — so it is found by lot on the same sheet.
 *
 * Scanned and compared rather than selected with an attribute, for `findPart`'s
 * reason one step removed: a lot id is a database uuid today and the rule this
 * file follows is that identities are compared, not interpolated into CSS.
 */
function slotFor(node: ChildEl, sel: PreviewSelection): ChildEl | null {
  const inFlow = node.closest(SLOT_SELECTOR);
  if (inFlow) return inFlow;
  const page = node.closest(PAGE_SELECTOR);
  if (!page) return null;
  for (const candidate of Array.from(page.querySelectorAll(SLOT_SELECTOR))) {
    if (candidate.getAttribute(ATTR.lot) === sel.lotId) return candidate;
  }
  return null;
}

/** Would painting these handles change anything? Same reasoning as `sameRings`. */
function sameHandles(a: readonly PaintedHandle[], b: readonly PaintedHandle[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((handle, i) => {
    const other = b[i]!;
    return handle.key === other.key && handle.at.x === other.at.x && handle.at.y === other.at.y;
  });
}

/** Would moving the bar change anything? Same reasoning as `sameRings`. */
function sameSpot(
  a: { x: number; y: number; side: ToolbarSide } | null,
  b: { x: number; y: number; side: ToolbarSide } | null,
): boolean {
  if (a === null || b === null) return a === b;
  return a.x === b.x && a.y === b.y && a.side === b.side;
}
