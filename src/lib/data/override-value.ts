// The override's VALUE — what a person may say, and how one saying merges into
// another. No database, and that is the point.
//
// ── WHY THIS IS NOT IN ./overrides.ts, WHERE IT WAS WRITTEN ─────────────────
//
// The polish panel is a client component and it has to merge. It shows what the
// row says, nothing in it disables while it writes (a field that disables loses
// the keystrokes that were on their way to it), and the patches it builds are
// MERGES — `groundSpecPatch` reads the ground in force to decide whether there
// is a spec to change at all. So a specialist who chooses a ground and then a
// tone, at the speed a hand does it, sends the second patch against a value the
// server has not answered on yet, and that patch comes out empty.
//
// The panel therefore has to apply its own patch to its own view of the row,
// which means importing the merge — and ./overrides.ts opens a connection at
// module scope's reach (`getDb`, drizzle, the schema). Importing it from a
// client component drags a Postgres driver into the browser bundle.
//
// Rejected: a second merge written for the panel. The merge IS the risk in this
// feature — the header of ./overrides.ts is mostly about the work a bad one
// destroys — and two of them is two answers to "what does this row say now".
//
// So the pure half moved here and ./overrides.ts re-exports every name it used
// to export, unchanged. Nothing that imported from there had to be edited, and
// the SQL still lives next to the statements it belongs to.

import { frameFromValue, roundFrame, type OverrideFrame } from "@/lib/engine/frame";
import {
  plateFromValue,
  type Ground,
  type GroundSpec,
  type PictureTreatment,
  type PlateGrade,
} from "@/lib/engine/plate";

/**
 * What a person may say about one field of one lot in one catalogue.
 *
 * Every key is OPTIONAL and absent means "nobody has said". That is what lets
 * one row hold any mixture of judgements — a hidden field, a corrected string,
 * a dragged frame, a chosen treatment — without a row type per kind of edit,
 * and what lets a row written before any of this keep meaning what it meant.
 *
 * A TYPE RATHER THAN AN INTERFACE so it is assignable to the jsonb column's
 * `Record<string, unknown>`; an interface has no implicit index signature and
 * the alternative is a cast at the one statement that must not be loosened.
 */
export type OverrideValue = {
  /** Do not print this field in this catalogue. Wins over `text`. */
  hidden?: boolean;
  /** Print this instead of the record's value, in this catalogue only. */
  text?: string;
  /**
   * Which page a person moved this part to. ZERO-BASED, the predecessor's
   * sense; `DocPage.number` is one-based for a human, and the conversion is the
   * engine's the day it honours this. Stored and not applied — see the engine's
   * `EngineOverride.pageIndex` for why.
   */
  pageIndex?: number;
  /** Where a person put this part, in fractions of the PAGE. */
  frame?: OverrideFrame;
  // ── The plate's own keys ──────────────────────────────────────────────────
  //
  // SPELLED OUT rather than intersected with `PlateTreatment`, although they
  // are exactly its keys and `plateFromValue` is what validates them. The
  // intersection compiles and then fails where it matters: TypeScript derives
  // an implicit index signature for an object TYPE and not for an interface, so
  // `OverrideValue & PlateTreatment` stops being assignable to the jsonb
  // column's `Record<string, unknown>` — which is the one statement the header
  // above says must not be loosened with a cast. `plate.test.ts` pins that the
  // two key sets agree, so they cannot drift apart in silence.
  /** What the plate IS: 去背, or `original` for the photograph as supplied. */
  picture?: PictureTreatment;
  /** What sits behind or around it. Absent is 無. */
  ground?: Ground;
  /** The ground's parameters, present only alongside a ground that takes them. */
  groundSpec?: GroundSpec;
  /**
   * How many passages an ultra-wide work is cut into, when a person has
   * disagreed with the count.
   *
   * 1 IS A VALUE, not an absence: it means "show this work whole across the
   * plate". Absence means "let whatever paints it decide".
   */
  bands?: number;
  /**
   * How far this plate's picture is turned inside its own rectangle, in
   * degrees, positive clockwise — the sense CSS `rotate()` uses.
   *
   * ABSENT IS LEVEL. Zero and absence are one state, so a plate nobody has
   * straightened is byte-identical to one rendered before this existed.
   */
  straightenDeg?: number;
  /**
   * A correction to the MEASURED subject box, by someone who can see the plate,
   * in fractions of the IMAGE — the space the measurement itself is stored in.
   *
   * IT IS THE ONLY PRODUCER. Nothing in this system measures a subject box:
   * `assets.geometry` holds `{width, height, format}` and no more. The spike
   * that decided not to add one is in src/lib/render/plate-css.ts's header.
   */
  content?: OverrideFrame;
  /**
   * 調色 — the five numbers a plate's colour is corrected by.
   *
   * THE NEWEST KEY IN THE ROW, and it arrived for the reason `straightenDeg`
   * and `content` did: the value an automatic pass would write has to be a
   * value a person can already set, or the first automatic correction is a lock
   * with no default on the one element in the catalogue that IS the client's
   * artwork (principle 9).
   */
  grade?: PlateGrade;
};

/**
 * A write. `undefined` leaves the stored key alone, `null` clears it.
 *
 * SEPARATE FROM `OverrideValue`, and the nulls are the whole of the difference:
 * what is STORED is a set of assertions, and there is no such thing as a stored
 * "clear". Folding the two together would make the write shape carry a null
 * that the read shape then has to explain away at every consumer.
 */
export interface OverridePatch {
  /** `false` un-hides; it does not clear the rest of the row. */
  hidden?: boolean;
  /** An empty or blank string clears, because that is all an empty box means. */
  text?: string | null;
  pageIndex?: number | null;
  frame?: OverrideFrame | null;
  content?: OverrideFrame | null;
  picture?: PictureTreatment | null;
  ground?: Ground | null;
  groundSpec?: GroundSpec | null;
  bands?: number | null;
  straightenDeg?: number | null;
  /** The five axes together. A null clears the whole grade — 原色. */
  grade?: PlateGrade | null;
}

/**
 * The keys a patch may touch, listed rather than taken from the patch object.
 *
 * `Object.entries(patch)` would be shorter and would also let a key nobody
 * declared reach a computed assignment on a plain object — `__proto__` among
 * them. A list is the same length as the interface above it and cannot.
 */
const PATCH_KEYS = [
  "hidden",
  "text",
  "pageIndex",
  "frame",
  "content",
  "picture",
  "ground",
  "groundSpec",
  "bands",
  "straightenDeg",
  "grade",
] as const;
/**
 * Read a stored `value` as a presentation override, or null when it is not one.
 *
 * `value` is jsonb and holds more than this module writes: the migration
 * carried the predecessor's proposals as `{proposal, kind, state, assetHash}`,
 * and a later proposer will write more of the same. A row this cannot read as a
 * presentation override is not an error — it is somebody else's value — and it
 * is simply not applied. Exported so the tests can hold that line.
 *
 * ── THE WRITER GOES THROUGH HERE TOO ────────────────────────────────────────
 *
 * `mergeOverride` normalises through this function rather than validating a
 * second time on the way in, so "what is stored" and "what is read" are one
 * rule with one implementation. That is what makes the round trip provable: a
 * value that survives a write is exactly the value that comes back, and there
 * is no second predicate to drift from this one. It also gives the delete rule
 * for free — a merged value with nothing left in it is null here, and a row
 * that asserts nothing is a row that should not exist.
 *
 * A value that calls itself a PROPOSAL is refused whatever else it carries.
 * The generalised rule below would already refuse today's migrated shape, which
 * has none of these keys — but the vision model proposing a FRAME is on the
 * roadmap, and a proposal carrying the key it is proposing must not read as a
 * decision the moment it is written. `decided_by` is the other half of that
 * guard (see listOverrides); this is the half that does not depend on a column.
 */
export function overrideFromValue(value: unknown): OverrideValue | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (record.proposal !== undefined) return null;

  const out: OverrideValue = {};
  if (record.hidden === true) out.hidden = true;
  if (typeof record.text === "string" && record.text.trim() !== "") {
    out.text = record.text;
  }
  if (
    typeof record.pageIndex === "number" &&
    Number.isInteger(record.pageIndex) &&
    record.pageIndex >= 0
  ) {
    out.pageIndex = record.pageIndex;
  }
  // ROUNDED HERE, in the one place both paths pass through. Six decimals is the
  // renderer's own resolution (FRAME_PRECISION), so anything finer cannot reach
  // the page; normalising once means the number the engine applies and the
  // number the database holds are the same number, and two writes of one drag
  // do not differ in bytes nobody can see.
  const frame = frameFromValue(record.frame);
  if (frame) out.frame = roundFrame(frame);
  // THE PLATE'S KEYS, THROUGH THE ENGINE'S OWN READER. Delegated rather than
  // repeated: the renderer switches on exactly these values, so a second
  // predicate here would be a second answer to "what does this row mean" and
  // the two would disagree on the day one of them gained a key. What this file
  // keeps is the rule that a merged value with nothing left in it is null.
  Object.assign(out, plateFromValue(record) ?? {});

  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Apply a patch to a stored value. PURE, and separated from the SQL on purpose:
 * the risk in this feature is the merge, not the statement.
 *
 * Returns null when nothing is left to assert, which is the caller's signal to
 * DELETE the row rather than store an empty one. Un-hiding a field that also
 * carries a frame therefore clears the hiding and keeps the frame, which is
 * what the person clicking it meant; un-hiding a field that carries nothing
 * else removes the row, which is what the old whole-value writer did and the
 * only part of it worth keeping.
 */
export function mergeOverride(
  current: OverrideValue,
  patch: OverridePatch,
): OverrideValue | null {
  const merged: Record<string, unknown> = { ...current };
  for (const key of PATCH_KEYS) {
    const value = patch[key];
    if (value === undefined) continue;
    if (value === null) delete merged[key];
    else merged[key] = value;
  }
  return overrideFromValue(merged);
}
