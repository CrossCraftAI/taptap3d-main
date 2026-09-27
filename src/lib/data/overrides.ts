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

import { touchCatalogue } from "./catalogues";

// ── THE PLATE TREATMENTS MOVED, AND THE COMMENT THAT STOOD HERE SAID WHEN ───
//
// This file used to DECLARE the plate vocabulary, under a paragraph that named
// its own expiry: they lived here rather than in the engine because "nothing in
// this system renders them yet, so storage is their only reader, and inventing
// a field in the pure engine that no output consumes would be noise in the one
// module that has to stay readable."
//
// An output consumes them now, so they are in src/lib/engine/plate.ts, which is
// what the renderer and the engine both read. Nothing about the STORAGE
// changed: the same keys, the same bounds, the same round trip, and the same
// single reader for the write path and the read path. They are re-exported
// below so that every importer of this module keeps working — a vocabulary is a
// public name, and moving a file is not a reason to make six call sites move
// with it.

export {
  GRADE_AMOUNT_MAX,
  GRADE_AXES,
  GRADE_FINE,
  GRADE_KEYS,
  GRADE_LABELS,
  GRADE_LEVEL_MAX,
  GRADE_STEP,
  GROUND_LEVELS,
  GROUND_TINTS,
  GROUNDS,
  KEYLINE_MAX_MM,
  KEYLINE_MIN_MM,
  MAX_BANDS,
  PICTURE_TREATMENTS,
  STRAIGHTEN_FINE_DEG,
  STRAIGHTEN_MAX_DEG,
  STRAIGHTEN_STEP_DEG,
  clampPlateGrade,
  type GradeKey,
  type Ground,
  type GroundLevel,
  type GroundSpec,
  type GroundTint,
  type PictureTreatment,
  type PlateGrade,
  type PlateTreatment,
} from "@/lib/engine/plate";

// THE VALUE VOCABULARY LIVES IN ./override-value.ts, and every name it used to
// declare is re-exported here — so this module's surface is unchanged and its
// header still describes the merge, which is still the thing that matters most
// about this table. That file says why the split exists: a client component
// cannot import a module that reaches the database, and there must be exactly
// one merge.
export {
  mergeOverride,
  overrideFromValue,
  type OverridePatch,
  type OverrideValue,
} from "./override-value";
import {
  mergeOverride,
  overrideFromValue,
  type OverridePatch,
  type OverrideValue,
} from "./override-value";

export interface OverrideRow extends EngineOverride, OverrideValue {
  id: string;
  updatedAt: Date;
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
