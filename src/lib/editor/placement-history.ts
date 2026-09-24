// What a placement was BEFORE, so it can be put back.
//
// ── THE MODULE LANDS BEFORE THE CONTROL, ON PURPOSE ─────────────────────────
//
// Undo is the next tranche and nothing in the interface reaches this yet. The
// entry shape is here now because it is the half of undo that cannot be
// retrofitted: the value a gesture replaced exists only in the instant before
// the write, and a layer that commits without recording it has destroyed the
// only copy. The button is a morning's work; the missing `before` is a feature
// that cannot be added to the edits already made.
//
// ── UNDO IS A PATCH, NOT A DELETE, AND THAT IS THE WHOLE POINT ──────────────
//
// An override row holds every kind of judgement about one (lot, field) — a
// hidden field, a corrected string, a dragged frame (src/lib/data/overrides.ts).
// So undoing a drag is not "remove the override": a specialist who fixed a typo
// and then moved the line would lose the typo fix, which is the exact failure
// `OverridePatch` was introduced to prevent. Undoing a drag sends the `frame`
// key and nothing else — the previous frame to restore one, or an explicit
// `null` to clear it and let the engine place the part again.
//
// That is why `before` is nullable rather than absent: null is a real state
// with a real inverse ("the engine placed this"), and it is expressible in the
// patch as `{ frame: null }`. An entry that simply had no `before` could only
// be undone by guessing.
//
// ── NOT A GENERAL UNDO STACK ────────────────────────────────────────────────
//
// Rejected: a command log covering every gesture in the editor — hiding a
// field, changing the density, pinning two lots. Those are separate writes with
// separate reaches (a density change is not keyed to a lot at all), and one
// stack over all of them would have to decide what "undo" means when the last
// two gestures touched different tables. This stack holds placements, which are
// the gestures a pointer makes and the ones a hand slips on.

import { roundFrame, type OverrideFrame } from "@/lib/engine/frame";

import type { PageFrame } from "./drag-geometry";
import { selectionKey, type PreviewSelection } from "./selection-geometry";

/** One placement: which part moved, from where, to where. */
export interface PlacementEntry {
  /**
   * `selectionKey`'s string for the part, so an entry is addressed exactly the
   * way a ring is and the two cannot disagree about what "the same part" means.
   */
  key: string;
  lotId: string;
  field: string;
  /** Where it was, or null when the ENGINE had placed it and nobody had moved it. */
  before: PageFrame | null;
  after: PageFrame;
  /** When, from the client's clock. For ordering within a session, nothing more. */
  at: number;
}

/**
 * How many placements are kept.
 *
 * A bound rather than a guess at how far back anyone reaches: the list lives in
 * a component's state for the life of one open editor, and the thing it must
 * not do is grow without limit while a specialist works a 500-lot sale for an
 * afternoon. Dropping the OLDEST is the only safe direction — the newest entry
 * is the one the next undo needs.
 */
export const HISTORY_LIMIT = 40;

/** Are these the same rectangle, to the numbers actually stored? */
export function sameFrame(a: PageFrame | null, b: PageFrame | null): boolean {
  if (a === null || b === null) return a === b;
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

/**
 * The entry a commit produces, or null when the commit moved nothing.
 *
 * A GESTURE THAT CHANGED NOTHING IS NOT AN ENTRY. Dragging a part and putting
 * it back exactly where it was is a real thing a hand does, and recording it
 * would make the next undo appear to do nothing at all — which a person reads
 * as a broken button rather than as a faithful history.
 */
export function entryFor(
  sel: PreviewSelection,
  before: PageFrame | null,
  after: PageFrame,
  at: number,
): PlacementEntry | null {
  // AT THE RENDERER'S OWN RESOLUTION, and this is what makes undo work at all.
  //
  // `after` arrives from the pointer as a full-precision fraction. What the
  // document then publishes as `data-page-frame` is that number stored — which
  // `overrideFromValue` rounds to `FRAME_PRECISION` — and printed at six
  // decimals. `stillApplies` compares the two exactly, so an entry holding the
  // raw number never matched the page it described: every undo reported "this
  // part has changed since it was placed", cleared the stack, and did nothing.
  // The button was unusable and said so in a sentence about somebody else.
  //
  // Rounding HERE rather than loosening the comparison is the honest half. The
  // history's job is to say what the system stored, not what the hand asked
  // for; a tolerance would also make the guard weaker against the case it
  // exists for — a part genuinely moved by someone else since.
  const kept = roundFrame(after);
  if (sameFrame(before, kept)) return null;
  return { key: selectionKey(sel), lotId: sel.lotId, field: sel.field, before, after: kept, at };
}

/**
 * Add an entry, oldest dropped past the limit.
 *
 * NO COALESCING, deliberately. A text editor merges a run of keystrokes into
 * one undo because a keystroke is not a decision; a placement is. Three drags
 * that walk a plate across a page are three decisions, and an undo that took
 * back all three because they were close together would be the tool overruling
 * the specialist, which is the thing principle 9 refuses. It also matters for
 * principle 5: gestures are counted, and a history that quietly merges them
 * would be a second, disagreeing count of the same work.
 */
export function record(
  history: readonly PlacementEntry[],
  entry: PlacementEntry,
  limit = HISTORY_LIMIT,
): PlacementEntry[] {
  const next = [...history, entry];
  return next.length > limit ? next.slice(next.length - limit) : next;
}

/** The most recent placement, or null on an untouched session. */
export function last(history: readonly PlacementEntry[]): PlacementEntry | null {
  return history.length === 0 ? null : history[history.length - 1]!;
}

/** The stack with its newest entry taken off, after that entry has been undone. */
export function dropLast(history: readonly PlacementEntry[]): PlacementEntry[] {
  return history.slice(0, Math.max(0, history.length - 1));
}

/**
 * The stack without any entry for one part.
 *
 * ── WHAT `Reset placement` OWES THE STACK ───────────────────────────────────
 *
 * A reset clears the frame, so every entry describing where that part used to
 * be now claims an `after` the document no longer has. `stillApplies` would
 * catch it — and would then clear the WHOLE stack, because a verification
 * failure means "somebody changed this behind me and I cannot tell what else
 * they touched". Here we are the somebody, and we know precisely which entries
 * we invalidated: the ones for this part, and no others.
 *
 * So the reset takes them out itself and leaves every other lot's history
 * usable. Throwing away an afternoon's undo because one part was reset is the
 * kind of over-correction a person notices and works around by never pressing
 * the button.
 *
 * KEYED THE WAY A RING IS, on `selectionKey`, so "the same part" means exactly
 * what it means everywhere else in this layer.
 */
export function forget(
  history: readonly PlacementEntry[],
  key: string,
): PlacementEntry[] {
  return history.filter((entry) => entry.key !== key);
}

/**
 * Is the document still the one this entry was recorded against?
 *
 * ── THE STACK IS IN A TAB AND THE TRUTH IS IN A TABLE ───────────────────────
 *
 * This history lives in one component's ref for the life of one open editor,
 * and the placement it describes lives in a row that anything may have changed
 * since: the same specialist in a second tab, a colleague on the same sale, a
 * lot form clearing the override, or the same person choosing a template, which
 * re-derives everything. An undo that posted `before` without looking would put
 * the part back to a position that was replaced an hour ago, silently, and the
 * screen would show a correction nobody made.
 *
 * So an entry is checked against what the renderer says is there NOW, read off
 * `data-page-frame` — the value that was STORED rather than the box that was
 * painted, which is the distinction `parsePageFrame` exists for. `after` is
 * exactly what this entry wrote; if the document no longer agrees, this entry
 * is not the last thing that happened to that part and the whole stack behind
 * it is equally suspect.
 *
 * NULL ON BOTH SIDES IS A MATCH and is a real state: an entry whose `after` was
 * cleared by a later undo is not a case this can meet (the undo drops it), but
 * a caller that has re-read the document and found no frame at all is asking a
 * legitimate question and gets a truthful no.
 */
export function stillApplies(
  entry: PlacementEntry,
  current: PageFrame | null,
): boolean {
  return sameFrame(entry.after, current);
}

/**
 * The patch that takes one placement back.
 *
 * ONLY THE `frame` KEY, which is the whole argument in this file's header: a
 * text correction, a hidden field or a plate treatment on the same (lot, field)
 * is not part of what a drag did and must survive being told to undo one. An
 * explicit `null` clears the frame and hands the part back to the engine —
 * distinguishable from an absent key, which would leave it where it is
 * (src/lib/data/overrides.ts, `mergeOverride`).
 */
export function undoPatch(entry: PlacementEntry): { frame: OverrideFrame | null } {
  return { frame: entry.before };
}

/** The inverse of the inverse, stated so redo cannot be written a second way. */
export function redoPatch(entry: PlacementEntry): { frame: OverrideFrame } {
  return { frame: entry.after };
}
