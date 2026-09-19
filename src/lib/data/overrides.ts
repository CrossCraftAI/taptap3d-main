// Overrides: per-catalogue judgement about one field of one lot.
//
// The record — `lots.fields` — is what a lot IS. An override is how THIS
// catalogue prints it, and it lives apart so that fixing a typo (the record) and
// leaving a field off one edition (the override) are two different gestures with
// two different reaches. See src/lib/data/lots.ts for the record's writer.
//
// Keyed `(catalogue, lot, field)` and never to a slot or a page: the unique
// index `overrides_scope` was created at M0 for exactly this, and this file is
// the first thing in the application to write through it.
//
// ── ONE ROW HOLDS EVERY KIND OF JUDGEMENT, SO A WRITE IS A PATCH ────────────
//
// The row used to be `{hidden, text}`, and a write built a fresh value and
// replaced the old one. That was harmless exactly as long as both keys arrived
// together from one form. It stops being harmless the moment the row can also
// hold a dragged frame: committing a drag would erase a text correction written
// a minute earlier, and saving the lot form would erase the drag — a
// specialist's work destroyed as a side effect of unrelated work, which is the
// most expensive thing this table can do and the one failure it cannot be
// argued out of afterwards.
//
// So a write MERGES. An absent key leaves the stored value alone, an explicit
// `null` clears that one key, and the row is deleted only when nothing is left
// to assert. The three must stay distinguishable: `hidden: false` arriving from
// an un-hide click is not "clear everything", and a drag that sends only a
// frame is not "the text was never corrected".
//
// Rejected: a setter per kind of edit — setFrame, setText, setTreatment. It
// reads tidier and it is the same replace under three names, because each would
// still have to read the row to avoid clobbering the other two, and three
// places to get that right is two places to get it wrong.
//
// Rejected: a column per kind, which is the predecessor's shape. It makes the
// merge SQL's problem instead of this file's, and it costs a migration every
// time a specialist can say something new — precisely what the jsonb column was
// chosen to avoid (src/db/schema.ts: "the value shape belongs to the editor").

import { and, eq, isNotNull } from "drizzle-orm";

import { catalogues, getDb, lots, overrides } from "@/db";
import type { EngineOverride } from "@/lib/engine/derive";
import { frameFromValue, roundFrame, type OverrideFrame } from "@/lib/engine/frame";

import { touchCatalogue } from "./catalogues";

// ── THE PLATE TREATMENTS: STORED WHOLE NOW, RENDERED LATER ──────────────────
//
// Ported from the predecessor's core/layout/document.ts, where each of these
// vocabularies was argued for at length against real catalogues. The STORAGE
// shape is adopted whole today even though this renderer paints none of it,
// because the alternative is a migration the first time the editor learns to
// cut a plate out — and a migration of human judgement is the one migration
// nobody can verify by looking.
//
// They live HERE rather than in the engine. The predecessor declared them in
// core because its layout tree was the artefact all four render paths shared,
// so the vocabulary the renderer switched on had to be the vocabulary the tree
// validated against. Nothing in this system renders them yet, so storage is
// their only reader, and inventing a field in the pure engine that no output
// consumes would be noise in the one module that has to stay readable.

/** What the plate IS: the photograph as supplied, or 去背 — cut out. */
export const PICTURE_TREATMENTS = ["original", "cutout"] as const;
export type PictureTreatment = (typeof PICTURE_TREATMENTS)[number];

/**
 * What sits behind or around the plate. ABSENT is 無 — there is no "none"
 * value, because a row that asserts nothing is a row that should not exist.
 *
 *   sweep     a studio ground with the soft falloff a curved paper roll gives.
 *   tone      a flat solid ground, from a curated set.
 *   mount     a passe-partout: a toned mat between hairlines and the picture.
 *   keyline   a thin rule box with generous air between the rule and the work.
 */
export const GROUNDS = ["sweep", "tone", "mount", "keyline"] as const;
export type Ground = (typeof GROUNDS)[number];

/** How bright the ground is — the specialist's own light / mid / dim. */
export const GROUND_LEVELS = ["light", "mid", "dim"] as const;
export type GroundLevel = (typeof GROUND_LEVELS)[number];

/** Its temperature. Three steps, not a colour picker: see the ladder's reason. */
export const GROUND_TINTS = ["neutral", "warm", "cool"] as const;
export type GroundTint = (typeof GROUND_TINTS)[number];

/**
 * The ground's parameters.
 *
 * ONE SHAPE FOR EVERY GROUND THAT TAKES PARAMETERS, rather than a backdrop spec
 * beside a keyline spec. The invariant that matters — a ground's parameters
 * cannot outlive its ground — is then one key to drop rather than two that can
 * be dropped inconsistently.
 */
export interface GroundSpec {
  level: GroundLevel;
  tint: GroundTint;
  /** The keyline's rule width in mm. Absent on every other ground. */
  widthMm?: number;
}

/** Narrower than this and the press loses the line; wider and it is a border. */
export const KEYLINE_MIN_MM = 0.25;
export const KEYLINE_MAX_MM = 2;

/**
 * Passages one ultra-wide work may be cut into.
 *
 * A sanity floor, not the rule that decides how many a scroll gets — that
 * belongs to whatever eventually paints them. This exists so a hand-edited row
 * cannot turn one plate into ten thousand.
 */
export const MAX_BANDS = 12;

/**
 * How far a plate's picture may be turned inside its own rectangle.
 *
 * Fifteen degrees, because straightening crops: the picture must still fill its
 * box after the turn, and at 15° on a 4:3 plate a quarter of the photograph is
 * already gone. A control that reached 45° would be offering to destroy the
 * plate with no warning in between. Stored to a hundredth of a degree, which is
 * the resolution an automatic leveller recovers and finer than a specialist can
 * see — 0.01° moves the corner of a 174mm plate by a sixth of a dot at 300dpi.
 */
export const STRAIGHTEN_MAX_DEG = 15;
const STRAIGHTEN_DP = 2;

/** Which grounds are drawn from a tone, and so carry a level and a tint. */
function groundTakesTone(ground: Ground | undefined): boolean {
  return ground === "sweep" || ground === "tone" || ground === "keyline";
}

/** Only the keyline draws a line, so only the keyline has a width. */
function groundTakesWidth(ground: Ground | undefined): boolean {
  return ground === "keyline";
}

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
  /**
   * A correction to the MEASURED subject box, by someone who can see the plate,
   * in fractions of the IMAGE — the space the measurement itself is stored in.
   */
  content?: OverrideFrame;
  /** What the plate IS: 去背, or absent for the photograph as supplied. */
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
] as const;

export interface OverrideRow extends EngineOverride, OverrideValue {
  id: string;
  updatedAt: Date;
}

const isOneOf = <T extends string>(
  list: readonly T[],
  value: unknown,
): value is T => typeof value === "string" && (list as readonly string[]).includes(value);

/**
 * A stored ground spec, or null when what is there is not one.
 *
 * BOTH OR NEITHER for the level and the tint: a half-written spec is not a
 * smaller spec, it is a corrupt one, and defaulting the missing half would
 * invent a colour nobody chose. The WIDTH is different and the asymmetry is
 * deliberate — three of the four grounds have no width at all — so it is
 * carried when present, clamped, and simply absent otherwise.
 */
function groundSpecFromValue(value: unknown, ground: Ground | undefined): GroundSpec | null {
  // A GROUND'S PARAMETERS CANNOT OUTLIVE ITS GROUND. Enforced on the way in AND
  // on the way out, because this is the one predicate both paths pass through:
  // a brightness with no ground is not work, it is a row asserting the colour
  // of a thing nobody is drawing, and left behind it would keep an otherwise
  // empty row alive and have this catalogue report an edit nobody made.
  if (!groundTakesTone(ground)) return null;
  if (typeof value !== "object" || value === null) return null;
  const { level, tint, widthMm } = value as Record<string, unknown>;
  if (!isOneOf(GROUND_LEVELS, level) || !isOneOf(GROUND_TINTS, tint)) return null;
  if (!groundTakesWidth(ground) || typeof widthMm !== "number" || !Number.isFinite(widthMm)) {
    return { level, tint };
  }
  return {
    level,
    tint,
    widthMm: Math.min(KEYLINE_MAX_MM, Math.max(KEYLINE_MIN_MM, widthMm)),
  };
}

/**
 * A stored straighten, or undefined when there is nothing to apply.
 *
 * CLAMPED RATHER THAN REFUSED. A value here has usually passed the write path,
 * but jsonb is jsonb and a hand-written statement or a restored backup can put
 * anything in it. A coarse angle is still an angle, so it is bounded and kept;
 * a read that could refuse a stored value is a catalogue nobody can open.
 * Rounded before the bound as well as by it, so 15.004 lands on 15.00 rather
 * than being clamped by a ten-thousandth of a degree.
 */
function straightenFromValue(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const f = 10 ** STRAIGHTEN_DP;
  const rounded = Math.round(value * f) / f;
  const bounded =
    Math.round(Math.min(STRAIGHTEN_MAX_DEG, Math.max(-STRAIGHTEN_MAX_DEG, rounded)) * f) / f;
  return bounded === 0 ? undefined : bounded;
}

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
  const content = frameFromValue(record.content);
  if (content) out.content = roundFrame(content);
  if (isOneOf(PICTURE_TREATMENTS, record.picture)) out.picture = record.picture;
  if (isOneOf(GROUNDS, record.ground)) out.ground = record.ground;
  const spec = groundSpecFromValue(record.groundSpec, out.ground);
  if (spec) out.groundSpec = spec;
  if (
    typeof record.bands === "number" &&
    Number.isInteger(record.bands) &&
    record.bands >= 1 &&
    record.bands <= MAX_BANDS
  ) {
    out.bands = record.bands;
  }
  const straighten = straightenFromValue(record.straightenDeg);
  if (straighten !== undefined) out.straightenDeg = straighten;

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

/**
 * The catalogue's overrides, as the engine wants them — DECISIONS ONLY.
 *
 * A row with `decided_by` null is a proposal nobody has confirmed, and a
 * proposal is not an edit (principle 9). Filtering here, in the one place the
 * engine's input is assembled, is what keeps that true regardless of what a
 * future proposer writes into `value`.
 */
export async function listOverrides(
  orgId: string,
  catalogueId: string,
): Promise<OverrideRow[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: overrides.id,
      lotId: overrides.lotId,
      field: overrides.field,
      value: overrides.value,
      updatedAt: overrides.updatedAt,
    })
    .from(overrides)
    .where(
      and(
        eq(overrides.orgId, orgId),
        eq(overrides.catalogueId, catalogueId),
        isNotNull(overrides.decidedBy),
      ),
    )
    .orderBy(overrides.createdAt);

  const out: OverrideRow[] = [];
  for (const row of rows) {
    const value = overrideFromValue(row.value);
    if (!value) continue;
    out.push({
      id: row.id,
      lotId: row.lotId,
      field: row.field,
      updatedAt: row.updatedAt,
      ...value,
    });
  }
  return out;
}

export async function listOverridesForLot(
  orgId: string,
  catalogueId: string,
  lotId: string,
): Promise<OverrideRow[]> {
  const all = await listOverrides(orgId, catalogueId);
  return all.filter((o) => o.lotId === lotId);
}

/** How many decided overrides each lot carries, for a list that marks them. */
export async function countOverridesByLot(
  orgId: string,
  catalogueId: string,
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  for (const row of await listOverrides(orgId, catalogueId)) {
    counts.set(row.lotId, (counts.get(row.lotId) ?? 0) + 1);
  }
  return counts;
}

/**
 * The lot must belong to the org AND to the catalogue's event. Three ids arrive
 * from a request and an id is not an authorisation; an override on a lot from a
 * different sale would also be a row the engine could never reach.
 */
async function lotIsInCatalogue(
  orgId: string,
  catalogueId: string,
  lotId: string,
): Promise<boolean> {
  const db = getDb();
  const [catalogue] = await db
    .select({ eventId: catalogues.eventId })
    .from(catalogues)
    .where(and(eq(catalogues.orgId, orgId), eq(catalogues.id, catalogueId)))
    .limit(1);
  if (!catalogue) return false;
  const [lot] = await db
    .select({ eventId: lots.eventId })
    .from(lots)
    .where(and(eq(lots.orgId, orgId), eq(lots.id, lotId)))
    .limit(1);
  return !!lot && lot.eventId === catalogue.eventId;
}

/**
 * Decide a field's presentation in this catalogue, MERGING with what is there.
 *
 * An UPSERT on the scope index, because a correction is one value per
 * (lot, field) and two rows would mean the engine had to pick. Deciding where a
 * proposal already sits replaces it — the human's answer to the machine's
 * question — and `decided_by` records who.
 *
 * ── WHY THE READ AND THE WRITE ARE ONE TRANSACTION ──────────────────────────
 *
 * A merge is read-modify-write, and read-modify-write outside a transaction is
 * the lost update this whole file exists to prevent, arrived at by a different
 * road: a drag committing while a toolbar write is in flight would produce a
 * row holding one of the two edits and no error anywhere. `FOR UPDATE` on the
 * existing row serialises the case that can actually happen — two writes to a
 * (lot, field) somebody is already working on.
 *
 * What it does NOT cover: two writes that both find NO row, where there is
 * nothing yet to lock. Both then insert, the unique index sends the second to
 * its `DO UPDATE`, and the second write wins whole. That is a first write
 * racing a first write on the same field in the same millisecond, the loser's
 * value was empty in every sequence that produces it, and closing it properly
 * needs an advisory lock on a key the row does not have yet. Named rather than
 * hidden.
 */
export async function setOverride(
  orgId: string,
  catalogueId: string,
  lotId: string,
  field: string,
  patch: OverridePatch,
  decidedBy: string,
): Promise<boolean> {
  if (!(await lotIsInCatalogue(orgId, catalogueId, lotId))) return false;

  const db = getDb();
  const scope = and(
    eq(overrides.orgId, orgId),
    eq(overrides.catalogueId, catalogueId),
    eq(overrides.lotId, lotId),
    eq(overrides.field, field),
  );
  const changed = await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ value: overrides.value })
      .from(overrides)
      .where(scope)
      .limit(1)
      .for("update");
    const current = (row ? overrideFromValue(row.value) : null) ?? {};
    const merged = mergeOverride(current, patch);
    // Nothing left to say is a clear, not an override with an empty value.
    if (!merged) {
      const gone = await tx.delete(overrides).where(scope).returning({ id: overrides.id });
      return gone.length > 0;
    }
    await tx
      .insert(overrides)
      .values({ orgId, catalogueId, lotId, field, value: merged, decidedBy })
      .onConflictDoUpdate({
        target: [overrides.catalogueId, overrides.lotId, overrides.field],
        set: { value: merged, decidedBy, updatedAt: new Date() },
      });
    return true;
  });
  if (changed) await touchCatalogue(orgId, catalogueId);
  return changed;
}

/**
 * Remove the override WHOLE; the record's own value prints again. Reversibility
 * is not a courtesy here — an automatic or human correction the specialist
 * cannot undo is a defect by principle 9, however good the correction.
 *
 * The whole row, deliberately, and it is the counterpart to the merge above: a
 * patch is how one judgement is changed without touching the others, and this
 * is how a person says "none of it". Two gestures, two functions, neither able
 * to be mistaken for the other.
 */
export async function clearOverride(
  orgId: string,
  catalogueId: string,
  lotId: string,
  field: string,
): Promise<boolean> {
  const db = getDb();
  const rows = await db
    .delete(overrides)
    .where(
      and(
        eq(overrides.orgId, orgId),
        eq(overrides.catalogueId, catalogueId),
        eq(overrides.lotId, lotId),
        eq(overrides.field, field),
      ),
    )
    .returning({ id: overrides.id });
  if (rows.length > 0) await touchCatalogue(orgId, catalogueId);
  return rows.length > 0;
}
