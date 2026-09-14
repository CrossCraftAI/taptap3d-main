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

import { and, eq, isNotNull } from "drizzle-orm";

import { catalogues, getDb, lots, overrides } from "@/db";
import type { EngineOverride } from "@/lib/engine/derive";

import { touchCatalogue } from "./catalogues";

/** What a person may say about a field in one catalogue. Both may be set. */
export interface OverrideValue {
  hidden?: boolean;
  text?: string;
}

export interface OverrideRow extends EngineOverride {
  id: string;
  updatedAt: Date;
}

/**
 * Read a stored `value` as the engine's shape, or null when it is not one.
 *
 * `value` is jsonb and holds more than these two keys: the migration carried the
 * predecessor's proposals as `{proposal, kind, state, assetHash}`, and the
 * editor overlay will add frames and angles later. A row the engine cannot read
 * as a presentation override is not an error — it is somebody else's value —
 * and it is simply not applied. Exported so the tests can hold that line.
 */
export function overrideFromValue(value: unknown): OverrideValue | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const out: OverrideValue = {};
  if (record.hidden === true) out.hidden = true;
  if (typeof record.text === "string" && record.text.trim() !== "") {
    out.text = record.text;
  }
  return out.hidden || out.text !== undefined ? out : null;
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
 * Decide a field's presentation in this catalogue.
 *
 * An UPSERT on the scope index, because a correction is one value per
 * (lot, field) and two rows would mean the engine had to pick. Deciding where a
 * proposal already sits replaces it — the human's answer to the machine's
 * question — and `decided_by` records who.
 */
export async function setOverride(
  orgId: string,
  catalogueId: string,
  lotId: string,
  field: string,
  value: OverrideValue,
  decidedBy: string,
): Promise<boolean> {
  const stored: Record<string, unknown> = {};
  if (value.hidden) stored.hidden = true;
  if (value.text !== undefined && value.text.trim() !== "") stored.text = value.text;
  // Nothing to say is a clear, not an override with an empty value.
  if (Object.keys(stored).length === 0) {
    return clearOverride(orgId, catalogueId, lotId, field);
  }
  if (!(await lotIsInCatalogue(orgId, catalogueId, lotId))) return false;

  const db = getDb();
  await db
    .insert(overrides)
    .values({ orgId, catalogueId, lotId, field, value: stored, decidedBy })
    .onConflictDoUpdate({
      target: [overrides.catalogueId, overrides.lotId, overrides.field],
      set: { value: stored, decidedBy, updatedAt: new Date() },
    });
  await touchCatalogue(orgId, catalogueId);
  return true;
}

/**
 * Remove the override; the record's own value prints again. Reversibility is
 * not a courtesy here — an automatic or human correction the specialist cannot
 * undo is a defect by principle 9, however good the correction.
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
