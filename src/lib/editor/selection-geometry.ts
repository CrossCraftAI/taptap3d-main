// The selection overlay's pure half — coordinates and identity.
//
// PORTED from the predecessor's (editor)/projects/[id]/editor/selection-geometry.ts
// (v0.2.2, decision E1), with its reasoning. Where this repository's renderer
// differs the comment says so and keeps the original's argument beside it.
//
// WHY THIS IS A SEPARATE FILE. vitest here runs in a node environment with no
// jsdom (vitest.config.ts says why), so selection-overlay.tsx cannot be
// rendered in a test; everything that can be decided without a DOM lives here
// and is tested, and the component keeps the listeners, the refs and the paint.
//
// WHAT IT DELIBERATELY DOES NOT DO: derive geometry from the document tree.
// Frames are normalised fractions of the page, so a rectangle COULD be
// recomputed from (page box × frame) without touching the DOM — and it would
// be wrong. The painted box already carries CJK line wrapping, the plate's
// object-fit, and the fluid type scale resolved against the actual page
// height. Recomputing re-derives all three and drifts from what the specialist
// can see. So the component reads real `getBoundingClientRect()` boxes out of
// `iframe.contentDocument` — legal because the preview is a same-origin ROUTE
// with no sandbox attribute (ARCHITECTURE.md principle 8), and no script runs
// INSIDE the frame — and these functions only move them into the overlay's
// coordinate space.

/**
 * What a selection IS: a lot and a field, never an element id.
 *
 * The predecessor's renderer gave every element a positional id
 * (`p{page}-s{slot}-f-{field}`), so the lot the specialist called P22 was
 * `p5-s1` at 4-up and `p2-s3` at 9-up. This renderer emits no element ids at
 * all — only `data-lot` and `data-field` — which is the same rule enforced
 * one step earlier. Overrides are keyed (lot, field) for exactly this reason
 * (principle 1), and a selection that could not be expressed in the same terms
 * would be a selection nothing could be saved against.
 */
export interface PreviewSelection {
  lotId: string;
  field: string;
  /**
   * Set when this selection is a FREE OBJECT (predecessor UAT 5, 12), and
   * equal to `field`. Free objects are a later tranche; the slot is kept so
   * that every consumer keying on `field` today keeps working the day they
   * land, and so a caption row and a free object on the same lot stay
   * distinguishable without a compound string in `field` that every consumer
   * would have to take apart.
   *
   * `objectId` is not a second identity. It is the FLAG that says which TABLE
   * that identity addresses. OPTIONAL, so every existing selection means
   * exactly what it meant.
   */
  objectId?: string;
  /**
   * Set when this selection is the lot's WHOLE CAPTION BLOCK rather than one
   * row of it (predecessor item C). Later tranche; carried for the reason
   * `objectId` is. `field` still carries a REAL field — the first member's —
   * and not a sentinel, because a sentinel only has to leak once into a write
   * to put a row in the database keyed to a field no renderer emits.
   */
  group?: "caption";
}

/** A rectangle in OVERLAY coordinates: CSS pixels from the layer's top-left. */
export interface OverlayRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The subset of DOMRect this module reads. Keeps the functions testable in node. */
export interface ChildRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** A point, in the same coordinates as whatever it is being compared against. */
export interface Point {
  x: number;
  y: number;
}

/**
 * Empty space above and below a box, in the same pixels the box is measured in.
 *
 * "Empty" means no OTHER painted element is there — not that the paper is blank.
 * See verticalClearance.
 */
export interface Clearance {
  /** The gap to the nearest neighbour, whether or not anything fits in it. */
  above: number;
  below: number;
  /**
   * How far PAST that neighbour a bar must travel to reach the nearest band of
   * empty page it actually fits in, or null when there is none within reach.
   *
   * Zero when the immediate gap is already big enough, so a caller that only
   * ever adds it gets the adjacent placement for free.
   *
   * ── WHY THIS EXISTS AND `above` IS NOT ENOUGH ──────────────────────────────
   * A 1-up caption is eight rows that ABUT — every gap in the stack is zero — so
   * "how much room is beside me" answers "none" on both sides for six of the
   * eight, and a rule built on it alone can only choose which row to cover. The
   * page nonetheless has somewhere to stand: 29px of paper between the plate and
   * the first caption line, which is the natural home for chrome and is two rows
   * away rather than forty. So the question the toolbar actually needs answered
   * is "where is the nearest place I cover NOTHING", and that is this.
   */
  liftAbove: number | null;
  liftBelow: number | null;
}

/**
 * A selection's box plus what is beside it — everything the floating toolbar
 * needs to choose a side.
 *
 * The clearance is optional and its absence means UNKNOWN, never zero: a caller
 * that cannot measure the neighbours (or a document rendered before this
 * existed) must get the old "above by preference" behaviour rather than a bar
 * that pins itself to the canvas edge because it was told there is no room
 * anywhere.
 */
export interface AnchorRect extends OverlayRect {
  clear?: Clearance;
  /**
   * How far the selected object is TURNED (predecessor UAT 18C), or absent for
   * upright. Rotation is a later tranche; the field travels with the box now so
   * the ruler and the toolbar — which read this one object — need no second
   * shape when it lands.
   */
  rotationDeg?: number;
}

/**
 * Horizontal overlap, and the vertical slack before a box counts as being above
 * or below rather than beside.
 *
 * One pixel, the same tolerance growthMark uses and for the same reason: these
 * are measured boxes whose edges are laid out from fractions, so two rows that
 * abut exactly land a fraction of a pixel apart. Without it a caption row would
 * report a neighbour 0.4px above as "not above", and the clearance would be the
 * whole page.
 */
const CLEAR_EPS_PX = 1;

/**
 * How much room a toolbar has above and below a box before it covers something.
 *
 * ── THE DEFECT THIS EXISTS FOR ──────────────────────────────────────────────
 * toolbarSpot's rule was "above by preference, below when there is no room",
 * where "no room" meant "off the top of the CANVAS". On a thin caption row forty
 * pixels down a page there is plenty of canvas above — and the row above it is
 * what the bar landed on. The bar exists so that controls never cover the
 * artwork, and it was covering content to avoid covering content.
 *
 * So "room" has to be a question about the PAGE, not about the viewport, and
 * only this layer can answer it: the neighbours are painted boxes in the child
 * document, and their positions carry CJK wrapping and the fluid type scale that
 * the tree cannot be asked about (see this file's header).
 *
 * `others` is deliberately the whole page's elements rather than the slot's: a
 * bar over the lot ABOVE this one is exactly as bad as one over its own caption,
 * and a slot boundary is invisible to the person looking at the page.
 *
 * ONLY BOXES THAT SHARE HORIZONTAL GROUND count. The bar is centred on the
 * selection and is at most a few hundred pixels wide, so a caption in the
 * neighbouring column of a 4-up page is not in its way; treating it as a
 * neighbour would report zero room on every page with more than one column and
 * flip every bar to the bottom of the canvas.
 *
 * `bounds` is the page. Beyond it lies the grey between sheets, which is chrome
 * rather than catalogue — a bar there covers nothing — but stopping at the paper
 * keeps the answer to "is there room" in the same object the specialist is
 * judging, and costs a bar at the very top of a page nothing, because a page's
 * top margin is real empty room.
 */
export function verticalClearance(
  target: OverlayRect,
  others: readonly OverlayRect[],
  bounds: { top: number; bottom: number },
  // REQUIRED, with no default. A band of 0 makes every gap "big enough" and the
  // lifts come back as 0 everywhere — a confidently wrong answer, which is the
  // shape of failure this function was written to stop.
  band: number,
  reach = Number.POSITIVE_INFINITY,
): Clearance {
  const targetBottom = target.y + target.h;
  // Only boxes that share horizontal ground, and only the part of each that is
  // on the right side of the target — a sweep is much easier to read when every
  // interval it walks is already clipped to the region being swept.
  const upward: Array<{ top: number; bottom: number }> = [];
  const downward: Array<{ top: number; bottom: number }> = [];
  for (const other of others) {
    if (other.x + other.w <= target.x + CLEAR_EPS_PX) continue;
    if (target.x + target.w <= other.x + CLEAR_EPS_PX) continue;
    const otherBottom = other.y + other.h;
    // "Has this box any ink ABOVE my top edge?", not "is this box entirely above
    // me?". The two differ exactly on a box that OVERLAPS the target — which a
    // grown caption sitting over the row beneath it makes an ordinary page
    // rather than a pathology. Classifying such a box as neither above nor
    // below dropped it from the answer altogether, and the clearance came back
    // as the whole sheet: the one shape of wrong answer this function exists to
    // stop, reported confidently.
    if (other.y < target.y - CLEAR_EPS_PX) {
      upward.push({
        top: Math.max(bounds.top, other.y),
        bottom: Math.min(target.y, otherBottom),
      });
    }
    if (otherBottom > targetBottom + CLEAR_EPS_PX) {
      downward.push({
        top: Math.max(targetBottom, other.y),
        bottom: Math.min(bounds.bottom, otherBottom),
      });
    }
  }
  const up = sweep(upward, target.y, bounds.top, -1, band, reach);
  const down = sweep(downward, targetBottom, bounds.bottom, 1, band, reach);
  return {
    above: up.gap,
    below: down.gap,
    liftAbove: up.lift,
    liftBelow: down.lift,
  };
}

/**
 * Walk away from one edge of the target through the boxes in the way, and
 * report two things: the gap immediately beside it, and how far it is to the
 * first gap of at least `band`.
 *
 * ONE FUNCTION FOR BOTH DIRECTIONS, driven by `dir`, because the two are the
 * same walk mirrored and a second copy is where the two would eventually
 * disagree — the up case would get a fix the down case did not, which is a bug
 * that only shows up on the last caption row of a page.
 *
 * `reach` keeps the answer honest about what a toolbar is FOR. A bar that
 * travelled half a page to find empty paper would be a control that has stopped
 * pointing at the thing it acts on — the same objection toolbarSpot makes about
 * returning a spot for a selection that has scrolled away — so beyond it the
 * answer is "there is nowhere", and the caller falls back to standing on
 * something nearby.
 */
function sweep(
  blockers: ReadonlyArray<{ top: number; bottom: number }>,
  edge: number,
  limit: number,
  dir: -1 | 1,
  band: number,
  reach: number,
): { gap: number; lift: number | null } {
  // Nearest first, i.e. by the edge that faces the target.
  const sorted = blockers
    .slice()
    .sort((a, b) => (dir < 0 ? b.bottom - a.bottom : a.top - b.top));
  let cursor = edge;
  let first: number | null = null;
  let lift: number | null = null;
  const consider = (gap: number): void => {
    if (first === null) first = Math.max(0, gap);
    if (lift === null && gap >= band) {
      const travel = Math.abs(cursor - edge);
      if (travel <= reach) lift = travel;
    }
  };
  for (const b of sorted) {
    const near = dir < 0 ? b.bottom : b.top;
    const far = dir < 0 ? b.top : b.bottom;
    // Already swallowed by a nearer blocker (they overlap), so it opens no gap.
    if (dir < 0 ? near >= cursor : near <= cursor) {
      cursor = dir < 0 ? Math.min(cursor, far) : Math.max(cursor, far);
      if (first === null) first = 0;
      continue;
    }
    consider(Math.abs(cursor - near));
    if (lift !== null) break;
    cursor = dir < 0 ? Math.min(cursor, far) : Math.max(cursor, far);
  }
  // The paper's own edge closes the last gap. Beyond it is the grey between
  // sheets, which is chrome rather than catalogue — but stopping at the trim
  // keeps the answer inside the object the specialist is judging, and costs a
  // page's own margin nothing, because a margin is real empty room.
  if (lift === null) consider(Math.max(0, Math.abs(limit - cursor)));
  return { gap: first ?? 0, lift };
}

/**
 * A child-document rectangle, moved into the overlay layer's coordinates.
 *
 * `origin` is the iframe's CONTENT box relative to the overlay layer's own
 * top-left. The layer is `absolute inset-0` over the iframe, so the layer's
 * origin is the iframe's BORDER box — and the predecessor's preview frame
 * carried a 1px border, which is exactly the kind of constant that produces a
 * ring sitting one pixel high and left of the thing it rings. This editor's
 * frame has no border, so the inset is zero; the component still passes
 * `clientLeft`/`clientTop`, which is the browser's own answer for that inset
 * rather than a number copied out of a Tailwind class, and the day a border
 * appears the ring will not move.
 *
 * SCROLL IS ALREADY IN THE INPUT, and this is the load-bearing half of the
 * conversion: `getBoundingClientRect()` inside the child is relative to the
 * CHILD'S VIEWPORT, so scrolling the preview (every page in one vertical flow)
 * moves the rect on its own. Adding `scrollY` here would double the scroll and
 * send every ring off the top of a scrolled page. The component re-reads rects
 * on scroll instead — which is the same "read the painted box, do not
 * reconstruct it" rule the module header states.
 */
export function toOverlayRect(child: ChildRect, origin: Point): OverlayRect {
  return {
    x: child.left + origin.x,
    y: child.top + origin.y,
    w: child.width,
    h: child.height,
  };
}

/**
 * The identity of a painted element, from the two attributes the renderer
 * publishes: `data-lot` and `data-field`, both on the element itself
 * (src/lib/render/html.ts). The predecessor read `data-lot` off the enclosing
 * slot; this renderer puts it on the element as well, so a part positioned
 * against the page rather than inside its slot still knows whose it is.
 *
 * NULL MEANS NOT SELECTABLE, and that is a feature. Page numbers, the blank
 * sheet, a price list's cells and any future structural slot have no
 * (lotId, field) an override could be written for — offering a selection there
 * would be offering an edit that silently cannot be saved. Empty and
 * whitespace-only strings are the same case as absent: `data-lot=""` is not a
 * lot.
 */
export function identityFrom(
  lotId: string | null | undefined,
  field: string | null | undefined,
  /**
   * `data-object` — present only on a free object (later tranche). The
   * renderer will publish it beside `data-field` rather than leaving it to be
   * inferred from a class name, on the rule the predecessor paid for four
   * times: a check that reconstructs what it should have been told cannot fail
   * when the thing it reconstructs changes.
   */
  objectId?: string | null,
): PreviewSelection | null {
  const lot = lotId?.trim();
  const f = field?.trim();
  if (!lot || !f) return null;
  const o = objectId?.trim();
  // A `data-object` that disagrees with `data-field` is a renderer bug, and it
  // is treated as NOT AN OBJECT rather than trusted: writing through the wrong
  // table is the one outcome worse than an unselectable box.
  return o && o === f ? { lotId: lot, field: f, objectId: o } : { lotId: lot, field: f };
}

/** Is this selection a FREE OBJECT rather than a caption or plate? */
export function isObjectSelection(
  sel: PreviewSelection | null,
): sel is PreviewSelection & { objectId: string } {
  return sel?.objectId !== undefined;
}

/**
 * A stable string for one identity, used as a React key.
 *
 * JSON, not `${lotId}-${field}`, because a naive join is not injective: lot
 * "a-b" + field "c" and lot "a" + field "b-c" would produce one key for two
 * different elements, and React would then paint one ring for two selections.
 * Lot ids are database uuids today, which is precisely the kind of "cannot
 * happen" that stops being true when the id source changes.
 */
export function selectionKey(sel: PreviewSelection): string {
  return JSON.stringify([sel.lotId, sel.field]);
}

/**
 * Same lot AND same field AND the same SCOPE. Null on either side means "no
 * selection".
 *
 * The scope is compared because a caption group carries its first member's
 * field (see PreviewSelection.group): without it 「the block」 and 「the block's
 * first row」 would be one selection. `group` is absent on every identity this
 * renderer publishes today, so nothing else here is affected.
 */
export function sameSelection(
  a: PreviewSelection | null,
  b: PreviewSelection | null,
): boolean {
  if (!a || !b) return false;
  return a.lotId === b.lotId && a.field === b.field && a.group === b.group;
}

/**
 * One box the overlay paints. `kind` decides its weight — the selection is a
 * clear ring, a hover is a whisper.
 */
export interface SelectionRing {
  key: string;
  /**
   * "subject" is the box being corrected in subject-box mode (later tranche),
   * and it takes the accent from the frame while that mode is on. The rule the
   * palette obeys is "blue is the thing you are manipulating", not "blue is the
   * element" — with the frame keeping a muted outline so it is still legible as
   * context. Two full-strength blue rings around two nested boxes would leave
   * the specialist dragging the wrong one.
   */
  kind: "selected" | "hover" | "subject" | "muted";
  rect: OverlayRect;
  /**
   * How far the ringed object is TURNED, or absent for upright. `rect` stays
   * the UPRIGHT FRAME and this turns it — the component paints the ring with a
   * `transform: rotate()` about its own centre, the same transform the
   * renderer applies to the ink, so the two agree by construction.
   */
  rotationDeg?: number;
  /**
   * Set when this ring is around a whole CAPTION BLOCK rather than one element.
   * PUBLISHED as `data-ring-scope`, on the rule this layer follows for every
   * piece of chrome: parent-side divs with no text and no role, so an audit
   * asking 「did the click ring the block or one row of it」 reads an attribute
   * rather than comparing rectangles in a screenshot.
   */
  scope?: "caption";
}

/**
 * A commented component's mark (predecessor E7), in overlay coordinates.
 * Comments are a later tranche; the geometry is here so the mark's placement
 * rule — and its test — travel with the layer they belong to.
 */
export interface CommentPin {
  key: string;
  /** Centre of the mark, just outside the element's top-right corner. */
  at: Point;
  count: number;
}

/**
 * Where a component's comment mark goes: just outside its top-right corner.
 *
 * OUTSIDE, and diagonally: the eight resize handles are centred ON the element's
 * corners, so a mark on the corner itself would sit under the `ne` handle of any
 * selected element — the one place a specialist is aiming a pointer. The offset
 * clears the handle's painted square without leaving the mark floating free of
 * the box it belongs to.
 */
const PIN_OFFSET_PX = 9;

export function pinPoint(rect: OverlayRect): Point {
  return { x: rect.x + rect.w + PIN_OFFSET_PX, y: rect.y - PIN_OFFSET_PX };
}

/**
 * The box a comment mark should hang off: what the note is ABOUT, not the box
 * the note is keyed to.
 *
 * ── THE DEFECT THIS EXISTS FOR (predecessor session 16, #12) ────────────────
 * A plate's FRAME is the reserved area and the picture sizes itself inside it,
 * so a plate whose picture sits low carries all its slack ABOVE the artwork.
 * Hanging the mark on the frame's top-right therefore put it in empty paper,
 * sometimes a third of a page above the photograph somebody had written about,
 * and on a page with two lots it pointed at the wrong one.
 *
 * INTERSECTED, not simply swapped for the picture: the plate clips, so the part
 * of the picture that lies outside the frame is not on the page at all, and a
 * mark against an invisible edge is the same defect pointing the other way. A
 * full-bleed plate's picture covers the whole frame and the intersection is the
 * frame, which is why that case needs no branch of its own.
 *
 * A null or degenerate picture (a caption, a page number, a plate the renderer
 * did not measure) yields the frame unchanged — the honest answer when the
 * element IS the thing being annotated.
 */
export function pinAnchor(
  frame: OverlayRect,
  picture: OverlayRect | null,
): OverlayRect {
  if (!picture) return frame;
  const x = Math.max(frame.x, picture.x);
  const y = Math.max(frame.y, picture.y);
  const w = Math.min(frame.x + frame.w, picture.x + picture.w) - x;
  const h = Math.min(frame.y + frame.h, picture.y + picture.h) - y;
  // No overlap at all is possible — a subject box measured off a mounted plate
  // can sit outside the window it is drawn in — and an empty rectangle would put
  // the mark somewhere neither box is.
  if (w <= 0 || h <= 0) return frame;
  return { x, y, w, h };
}

/** Would painting these pins change anything? Same reasoning as sameRings. */
export function samePins(a: readonly CommentPin[], b: readonly CommentPin[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((pin, i) => {
    const o = b[i]!;
    return (
      pin.key === o.key &&
      pin.count === o.count &&
      pin.at.x === o.at.x &&
      pin.at.y === o.at.y
    );
  });
}

/**
 * A box that had to grow past the height the engine designed for it
 * (predecessor E4).
 *
 * `rect` is the strip of GROWTH — from the designed bottom edge to the painted
 * one — not the whole element. That is the whole point of the mark: the box is
 * fine, the last N millimetres of it are the part that had to be taken from
 * somewhere, and those are the millimetres that may now be sitting on top of the
 * field below. Outlining the element instead would say "something is wrong with
 * this caption", which is not what happened and not what the specialist can act
 * on.
 *
 * This renderer publishes no `data-min-h` yet — its caption boxes are bounded
 * by the engine's budget rather than grown — so no mark is painted today. The
 * geometry stays so the mark arrives with the attribute and not with a second
 * implementation.
 */
export interface GrowthMark {
  key: string;
  rect: OverlayRect;
  /** Millimetres-agnostic: how far past the design it went, in overlay pixels. */
  overflowPx: number;
}

/**
 * Sub-pixel slack before growth is called growth.
 *
 * The designed height arrives as a fraction of the page and is multiplied by a
 * measured page box, so it lands a fraction of a pixel away from what the browser
 * laid out even when the two agree exactly. Marking that would put an amber strip
 * under every one of a 43-page preview's field boxes — a warning on all 280 rows
 * is the same as no warning at all. One pixel is well under the 4.2mm (≈16px)
 * line this can ever be wrong by, so nothing real hides under it.
 */
const GROWTH_EPSILON_PX = 1;

/**
 * The designed height an element published, as a fraction of the page.
 *
 * `data-min-h` is written by the renderer precisely so this is a read and not a
 * reconstruction. Absent ⇒ null ⇒ this element cannot grow and is not marked —
 * which is the honest answer for a plate or a page number, and also for every
 * document this renderer emits today.
 */
export function parseDesignedHeight(attr: string | null | undefined): number | null {
  if (attr == null) return null;
  const n = Number(attr);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * The growth strip for one painted box, or null if it did not grow.
 *
 * `pageH` is the MEASURED height of the `.page` the element sits on, so the
 * comparison happens in the same pixels the box was measured in — at any zoom, at
 * any viewport width, in either render mode. That is why the renderer publishes a
 * page FRACTION rather than a length: a length would have to be parsed out of a
 * mm-or-vh string and re-resolved against the page, which is the arithmetic this
 * check is meant to be auditing.
 */
export function growthMark(
  key: string,
  rect: OverlayRect,
  designedH: number | null,
  pageH: number,
): GrowthMark | null {
  if (designedH === null || pageH <= 0) return null;
  const designedPx = designedH * pageH;
  const overflowPx = rect.h - designedPx;
  if (overflowPx <= GROWTH_EPSILON_PX) return null;
  return {
    key,
    rect: { x: rect.x, y: rect.y + designedPx, w: rect.w, h: overflowPx },
    overflowPx,
  };
}

/** Would painting these marks change anything? Same reasoning as sameRings. */
export function sameMarks(a: readonly GrowthMark[], b: readonly GrowthMark[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((m, i) => {
    const o = b[i]!;
    return (
      m.key === o.key &&
      m.rect.x === o.rect.x &&
      m.rect.y === o.rect.y &&
      m.rect.w === o.rect.w &&
      m.rect.h === o.rect.h
    );
  });
}

/**
 * Would painting `next` change anything?
 *
 * The component re-measures on every scroll frame, and without this it would
 * `setState` a fresh array 60 times a second while the specialist scrolls a
 * 43-page preview with nothing even selected — a re-render per frame to paint
 * the same nothing. Exact equality, not a tolerance: a sub-pixel change is the
 * ring genuinely moving with the page, and a ring that lags the artwork it rings
 * is worse than one that re-renders.
 */
export function sameRings(a: readonly SelectionRing[], b: readonly SelectionRing[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((ring, i) => {
    const other = b[i]!;
    return (
      ring.key === other.key &&
      ring.kind === other.kind &&
      ring.rect.x === other.rect.x &&
      ring.rect.y === other.rect.y &&
      ring.rect.w === other.rect.w &&
      ring.rect.h === other.rect.h &&
      // Exact, like the four above it, and for the same reason: a ring that
      // lagged the ink it rings by one frame of a turn is worse than one that
      // re-renders. `undefined` and `undefined` compare equal, so an upright
      // document is unaffected.
      ring.rotationDeg === other.rotationDeg
    );
  });
}
