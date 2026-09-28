// Picking a run of rows with the pointer.
//
// ── ONE IMPLEMENTATION, BECAUSE THE SECOND ONE IS ALWAYS SUBTLY DIFFERENT ───
//
// This was fifteen lines inside src/components/photograph-library.tsx, and the
// sale's index needed the same gesture. Copying it would have been the cheaper
// edit and the two copies would have diverged at the first bug — the anchor's
// behaviour after a shift-click is the kind of detail nobody re-derives the
// same way twice, and it is invisible until somebody selects forty rows and
// gets thirty-nine.
//
// PURE AND INDEXED BY POSITION, so the whole gesture is a table of cases in
// test/selection.test.ts rather than something only a pointer can find out.

export interface Selection {
  /** The ids picked, in no order — membership is the whole of the state. */
  readonly ids: ReadonlySet<string>;
  /**
   * Where the next shift-click extends FROM, as an index into the rows on
   * screen, or null before anything has been clicked.
   *
   * AN INDEX AND NOT AN ID, because the run a person means is the run they can
   * see: "from that one down to this one" is positional, and an id would still
   * resolve after a filter had moved the row somewhere else in the list.
   */
  readonly anchor: number | null;
}

export const NOTHING: Selection = { ids: new Set(), anchor: null };

/**
 * Apply one click to a selection.
 *
 * Shift extends from the anchor to the row clicked, which is how every file
 * manager and every ERP grid behaves — assigning forty consecutive photographs
 * to one lot, or moving a run of lots into a crate, is the common case, and
 * forty clicks is not a workflow.
 *
 * ── THE ANCHOR MOVES EVEN ON A SHIFT-CLICK ─────────────────────────────────
 *
 * So a second shift-click extends from where the LAST one landed rather than
 * from the original anchor. Both behaviours exist in the wild; this one is the
 * one that lets a person walk a selection down a long list in steps, and it is
 * what the library shipped, so it is what the extraction keeps. Written down
 * because it is the first thing a reimplementation gets differently.
 *
 * ── A SHIFT-CLICK ONLY ADDS ────────────────────────────────────────────────
 *
 * It never removes, even when the whole run is already picked. Extending a
 * selection and inverting one are different intentions, and a gesture that
 * silently did the second would undo a careful run at the last click.
 */
export function click(
  current: Selection,
  /** The ids on screen, in the order they are drawn. */
  rows: readonly string[],
  index: number,
  shiftKey: boolean,
): Selection {
  const id = rows[index];
  if (id === undefined) return current;

  const ids = new Set(current.ids);
  if (shiftKey && current.anchor !== null && rows[current.anchor] !== undefined) {
    const [from, to] =
      current.anchor < index ? [current.anchor, index] : [index, current.anchor];
    for (let i = from; i <= to; i++) ids.add(rows[i]!);
  } else if (ids.has(id)) {
    ids.delete(id);
  } else {
    ids.add(id);
  }
  return { ids, anchor: index };
}

/** Nothing picked, and no anchor to extend from. */
export function cleared(): Selection {
  return NOTHING;
}

/**
 * The picked ids that are actually on screen, in the order they are drawn.
 *
 * WHAT A BULK ACTION IS ALLOWED TO ACT ON. A selection can outlive the rows it
 * was made over — a filter changes, a page turns — and an action that wrote to
 * ids nobody can see any more is the failure both screens are keyed against
 * (the component is remounted on a new query). This is the belt to that
 * bracing: the set is intersected with what is drawn before anything is sent,
 * so the count on the button and the rows that change are the same rows.
 */
export function onScreen(
  current: Selection,
  rows: readonly string[],
): string[] {
  return rows.filter((id) => current.ids.has(id));
}
