// Two frames, so a commit does not throw the reader back to the top of the sale.
//
// ── THE DEFECT THIS EXISTS FOR ──────────────────────────────────────────────
//
// The preview is ONE document holding every page in a vertical flow, and it
// reloads when — and only when — its `src` changes (src/app/events/[id]/
// catalogue/page.tsx says why the parameters are in the URL). Every commit
// touches the catalogue row, which moves `updatedAt`, which moves `previewKey`,
// which moves the `src`. So the frame navigates, and a navigated frame is at
// scroll zero: drag a plate on page 31 and the answer arrives at page 1.
//
// A single frame cannot avoid it. Restoring `scrollTop` after the load is the
// obvious build and it is a visible jump — the browser paints the top of the
// document first — which on a long sale is a white flash and a lurch on every
// edit.
//
// So the new document loads in a SECOND frame that is already laid out but not
// showing, is scrolled to where the reader is, and is then swapped in. The
// reader sees the page they were looking at, changed.
//
// ── LAID OUT, NOT HIDDEN, AND THAT IS NOT A DETAIL ──────────────────────────
//
// The back frame is transparent (`opacity: 0`) and never `display: none`. A
// display:none iframe lays out at a zero viewport, and this renderer's page is
// sized from the viewport — `height: calc(100vh - 32px)` at fit-page, and a
// body type of `clamp(7px, Nvh, cap)` (src/lib/render/html.ts) — so a hidden
// frame would resolve the type scale and re-run CJK line breaking against
// nothing, and the swap would show a document laid out for a window that does
// not exist. The measurement in canvas-geometry.ts's two-up note is the same
// fact from the other side: halve the frame and the type halves with it.
//
// `visibility: hidden` was the other candidate and is refused for a smaller
// reason: it lays out, but it also stops the frame being a paint target in
// some engines, and the point of the back buffer is that it has finished
// painting before it is shown.
//
// ── EXACTLY ONE FRAME ANSWERS TO THE NAME ───────────────────────────────────
//
// Five driven specs select `iframe[title="Catalogue preview"]` (grep test/e2e)
// and Playwright's locators are strict: two matches is a failure, not a first
// match. So the title is a function of the ROLE, not of the slot, and
// `titleOf` is the only thing that decides it. The test holds that invariant
// over every state this module can reach, because a second element answering
// to that name breaks all five at once in a way that reads as a Playwright
// problem rather than as an editor change.
//
// ── ONE PIECE OF STATE, AND THE REST IS DERIVED EVERY RENDER ────────────────
//
// What is remembered is only WHICH FRAME IS SHOWING AND WHAT IT SHOWS. Both
// `src` attributes are then a pure function of that plus the document the
// server currently wants, so nothing has to be kept in step and no effect has
// to write state in response to a prop — a cascade React's own lint rules
// refuse, and rightly: the first version of this file held both `src`s in
// state, and the effect that filled them could see a back buffer already
// carrying the wanted URL and conclude it had finished loading it.
//
// The blank is what makes that work. After a swap the outgoing frame is sent
// to `about:blank`, so the next change is always a real navigation with a real
// `load` event — including the case where the reader asks for a document that
// frame was holding a moment ago. Keeping the old document to save that one
// fetch was the alternative, and it deadlocks: the attribute would already be
// the wanted URL, React would change nothing, and no load event would ever
// arrive to trigger the swap.

/** Which of the two frames. Nothing outside this module should care which. */
export type Slot = 0 | 1;

/** The name the driven specs know the preview by. Exactly one frame has it. */
export const FRONT_TITLE = "Catalogue preview";

/**
 * The other one. It is deliberately not "Catalogue preview 2": a name that
 * merely differs would still be found by a person searching the accessibility
 * tree for the preview, and this frame is not one — it is a document being
 * prepared, and it says so.
 */
export const BACK_TITLE = "Catalogue preview, loading";

/**
 * What the idle frame points at.
 *
 * An explicit URL and not an absent attribute: REMOVING `src` does not
 * navigate a frame, it leaves the document that is already in it, and an empty
 * string navigates to the embedding page — which would put the whole editor
 * inside its own canvas.
 */
export const BLANK = "about:blank";

export interface BufferState {
  /** The slot the reader is looking at. */
  front: Slot;
  /** The document it shows. */
  shown: string;
}

/** The slot that is not showing. */
export function back(state: BufferState): Slot {
  return state.front === 0 ? 1 : 0;
}

/** The accessible name for one slot. A FUNCTION OF THE ROLE — see the header. */
export function titleOf(state: BufferState, slot: Slot): string {
  return slot === state.front ? FRONT_TITLE : BACK_TITLE;
}

/** The first document, in the first frame. */
export function openBuffers(src: string): BufferState {
  return { front: 0, shown: src };
}

/**
 * The `src` attribute for one slot, given the document the server now wants.
 *
 * THE FRONT IS NEVER GIVEN ANYTHING BUT WHAT IT ALREADY SHOWS, which is the
 * invariant the whole file is for: the document the reader is looking at is
 * not navigated, so it cannot flash, cannot go blank and cannot lose its
 * scroll while the new one is fetched.
 */
export function srcFor(state: BufferState, slot: Slot, wanted: string): string {
  if (slot === state.front) return state.shown;
  return wanted === state.shown ? BLANK : wanted;
}

/**
 * Has a frame that just finished loading got the document to swap in?
 *
 * `href` is the frame's OWN location, absolute, and `wantedHref` is the same
 * URL resolved against the page. Compared rather than assumed, because a
 * `load` event belonging to a navigation we have since replaced would
 * otherwise put a stale page in front of the reader — a real sequence when two
 * commits land close together.
 */
export function readyToShow(
  state: BufferState,
  slot: Slot,
  wanted: string,
  wantedHref: string,
  href: string | null | undefined,
): boolean {
  if (slot === state.front) return false;
  if (wanted === BLANK || wanted === state.shown) return false;
  return href === wantedHref;
}

/** Swap: this frame is the preview now, and it is showing this document. */
export function show(state: BufferState, slot: Slot, shown: string): BufferState {
  return { front: slot, shown };
}
