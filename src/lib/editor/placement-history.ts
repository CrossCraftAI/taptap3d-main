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

import type { OverrideFrame } from "@/lib/engine/frame";

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
  if (sameFrame(before, after)) return null;
  return { key: selectionKey(sel), lotId: sel.lotId, field: sel.field, before, after, at };
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
