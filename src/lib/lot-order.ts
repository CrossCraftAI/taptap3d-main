// The running order of a sale, and the one invariant it must not break.
//
// ── WHY THE ORDER IS EDITORIAL WORK AND NOT A DETAIL ───────────────────────
//
// For an auction house the running order IS the catalogue: the opener, the
// cover lot, what faces what across a spread. Until now `lots.position` had
// exactly one writer — the importer — so the order was frozen at whatever
// order the client's spreadsheet happened to be in, and `createPin` refused
// any pin whose lots were not already neighbours because there was no way to
// make them neighbours.
//
// ── THE TRAP, WHICH TWO LEGAL OPERATIONS REACH TOGETHER ────────────────────
//
// The engine keeps pinned lots together by walking the sale IN ORDER and
// merging a lot into the current run only when the lot immediately before it
// carries the same pin (src/lib/engine/derive.ts). `createPin` enforces
// adjacency ONCE, at creation, which was sufficient only because order was
// immutable.
//
// Make order mutable and the forbidden state is reachable by two individually
// legal acts: pin P04+P05, then drag P06 between them. The set check already
// passed, positions renumber, the preview reloads — and the pin silently
// stops doing anything. Nothing is cut, nothing is marked, nothing fails. The
// specialist finds out at the printer.
//
// ── THE ANSWER: A PIN IS ONE BLOCK, SO THE STATE IS UNREACHABLE ────────────
//
// Rather than refusing moves or marking broken pins afterwards, the unit of
// reordering is a BLOCK — a pinned run, or a single unpinned lot. Dragging
// any member of a pin moves the whole pin; a drop that would land "inside" a
// pinned run resolves to before or after it.
//
// That is worth more than it looks. There is no new broken state to detect,
// no warning for somebody to miss, and no refusal to explain — and
// `createPin`'s "pinned lots must be neighbours" stays a true statement about
// the product rather than becoming a rule that holds only at creation.

/** A pin, as this module needs it: which lots are held together. */
export interface OrderPin {
  keepsTogether: boolean;
  lotIds: readonly string[];
}

/**
 * One draggable thing: a pinned run, or a single lot.
 *
 * `pinned` is what the list draws a bracket around, and what makes a drag of
 * one row visibly pick up three.
 */
export interface Block {
  lotIds: string[];
  pinned: boolean;
}

/**
 * Split the sale into blocks, in order.
 *
 * ONLY CONSECUTIVE MEMBERS MERGE, which mirrors the engine exactly — and that
 * is the point rather than a coincidence. If a database already holds a pin
 * whose members are not adjacent (written before this existed, or by hand),
 * the engine treats it as two runs and so does this: the blocks a person
 * drags are the runs the engine will paginate. A function that healed the
 * split here would show somebody a layout the printer will not produce.
 */
export function blocksOf(order: readonly string[], pins: readonly OrderPin[]): Block[] {
  const groupOf = new Map<string, string>();
  for (const pin of pins) {
    if (!pin.keepsTogether) continue;
    const id = pin.lotIds.join("|");
    // First pin wins, as the engine's own `groupOf` does: a lot in two
    // keeping-together pins is a contradiction, and both places resolve it
    // the same way so neither can disagree about what a run is.
    for (const lotId of pin.lotIds) if (!groupOf.has(lotId)) groupOf.set(lotId, id);
  }

  const blocks: Block[] = [];
  for (const lotId of order) {
    const group = groupOf.get(lotId);
    const last = blocks[blocks.length - 1];
    const lastGroup = last ? groupOf.get(last.lotIds[0]!) : undefined;
    if (group && last && lastGroup === group) last.lotIds.push(lotId);
    else blocks.push({ lotIds: [lotId], pinned: group !== undefined });
  }
  // A block of one is not pinned in any sense a person can see — there is
  // nothing being held to anything — so it does not get a bracket.
  for (const block of blocks) if (block.lotIds.length < 2) block.pinned = false;
  return blocks;
}

/**
 * Where one lot sits among the blocks.
 *
 * Returns -1 for a lot the sale does not hold, which a caller treats as "do
 * nothing" rather than as an error: a drag can outlive the row it started on
 * if somebody else deletes a lot mid-gesture.
 */
export function blockIndexOf(blocks: readonly Block[], lotId: string): number {
  return blocks.findIndex((block) => block.lotIds.includes(lotId));
}

/**
 * Move the block holding `lotId` so it sits where `beforeLotId` is now, or to
 * the end when `beforeLotId` is null.
 *
 * ── THE DROP TARGET IS A LOT, NOT AN INDEX ────────────────────────────────
 *
 * An index is positional, and this codebase's first principle is that nothing
 * is keyed positionally — the same drop is index 4 before the move and index
 * 3 after it, and a caller that computed one and sent the other would move a
 * lot somewhere nobody pointed at. A lot id survives the renumbering.
 *
 * Dropping onto a lot INSIDE a pinned run resolves to that run's own place,
 * which is the whole mechanism: there is no way to express "between P04 and
 * P05" because those two are one thing.
 *
 * Returns the sale's new order. The input is never mutated.
 */
export function moveBefore(
  order: readonly string[],
  pins: readonly OrderPin[],
  lotId: string,
  beforeLotId: string | null,
): string[] {
  const blocks = blocksOf(order, pins);
  const from = blockIndexOf(blocks, lotId);
  if (from < 0) return [...order];

  const moving = blocks[from]!;
  const rest = blocks.filter((_, i) => i !== from);

  if (beforeLotId === null) return [...rest, moving].flatMap((b) => b.lotIds);

  // DROPPING ONTO ITSELF IS A NO-OP, including onto another member of the
  // same pin — a drag that ends where it began must not renumber the sale and
  // invalidate every preview in the building.
  if (moving.lotIds.includes(beforeLotId)) return [...order];

  const at = blockIndexOf(rest, beforeLotId);
  if (at < 0) return [...order];
  return [...rest.slice(0, at), moving, ...rest.slice(at)].flatMap((b) => b.lotIds);
}

/**
 * The keyboard's version: move the block holding `lotId` one place up or down.
 *
 * THE KEYBOARD IS NOT AN ALTERNATIVE, IT IS THE SAME GESTURE. A drag that
 * cannot be done from a keyboard is a feature a specialist with a trackpad
 * injury cannot use, and — the part that is checkable — a feature no test can
 * drive deterministically. Both end in one call to `moveBefore`, so they
 * cannot disagree about what a move means.
 */
export function nudge(
  order: readonly string[],
  pins: readonly OrderPin[],
  lotId: string,
  direction: "up" | "down",
): string[] {
  const blocks = blocksOf(order, pins);
  const at = blockIndexOf(blocks, lotId);
  if (at < 0) return [...order];

  if (direction === "up") {
    if (at === 0) return [...order];
    return moveBefore(order, pins, lotId, blocks[at - 1]!.lotIds[0]!);
  }
  const next = blocks[at + 1];
  if (!next) return [...order];
  const after = blocks[at + 2];
  // Past the next block: before the one after it, or to the end when the next
  // block is the last. Expressed as "before X" so there is one mover.
  return moveBefore(order, pins, lotId, after ? after.lotIds[0]! : null);
}
