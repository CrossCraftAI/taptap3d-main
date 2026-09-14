// Writing lots, and reading them back.

import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { PgUpdateSetSource } from "drizzle-orm/pg-core";

import { assets, events, getDb, lotAssets, lots } from "@/db";
import type { PreparedLot } from "@/lib/import/apply";

export async function listLots(
  orgId: string,
  eventId: string,
): Promise<(typeof lots.$inferSelect)[]> {
  const db = getDb();
  return db
    .select()
    .from(lots)
    // Both, always — an id alone is not an authorisation.
    .where(and(eq(lots.orgId, orgId), eq(lots.eventId, eventId)))
    // The same total order as listLotsWithImages, for the same reason.
    .orderBy(asc(lots.position), asc(lots.createdAt), asc(lots.id));
}

/**
 * Write an import's worth of lots.
 *
 * ONE STATEMENT, not a loop. A 500-lot sale inserted row by row is 500 round
 * trips, and — the part that matters more — a failure halfway leaves half a sale
 * in the database with no way to tell which half. A single multi-row insert is
 * atomic by construction.
 *
 * Position comes from FILE ORDER. The house sequenced the sheet deliberately;
 * re-sorting it on the way in would silently discard that, and `ref` is a string
 * ("P01", "Lot 12a") so it cannot be sorted numerically anyway.
 */
export async function insertLots(
  orgId: string,
  eventId: string,
  prepared: PreparedLot[],
): Promise<number> {
  if (prepared.length === 0) return 0;
  const db = getDb();
  const rows = await db
    .insert(lots)
    .values(
      prepared.map((lot, index) => ({
        orgId,
        eventId,
        ref: lot.ref,
        fields: lot.fields,
        position: index,
      })),
    )
    .returning({ id: lots.id });
  return rows.length;
}

export interface LotWithImages {
  id: string;
  ref: string | null;
  fields: Record<string, unknown>;
  position: number;
  /** When the record last changed. The preview keys on it, so an edit reloads. */
  updatedAt: Date;
  /** Content hashes, primary first — the order the engine reads as significance. */
  images: string[];
}

/**
 * Lots with their photographs, for the workspace and for the engine.
 *
 * A LEFT JOIN and one pass, not a query per lot. `is_primary` descending first
 * so the primary plate lands at `images[0]`, which is the only element the
 * engine reads; then `position`, then the hash, so the order is TOTAL — two
 * non-primary photographs with the same position must not swap places between
 * two renders of the same catalogue.
 */
export async function listLotsWithImages(
  orgId: string,
  eventId: string,
): Promise<LotWithImages[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: lots.id,
      ref: lots.ref,
      fields: lots.fields,
      position: lots.position,
      updatedAt: lots.updatedAt,
      hash: assets.contentHash,
      isPrimary: lotAssets.isPrimary,
      assetPosition: lotAssets.position,
    })
    .from(lots)
    .leftJoin(lotAssets, eq(lotAssets.lotId, lots.id))
    .leftJoin(assets, eq(assets.id, lotAssets.assetId))
    .where(and(eq(lots.orgId, orgId), eq(lots.eventId, eventId)))
    // TOTAL ORDER ON THE LOTS TOO, not only on their photographs. `position` is
    // numbered from zero per import, so two imports into one event tie, and a
    // tie left to Postgres can come back in a different order between two
    // renders of the same catalogue — which would move lots between pages with
    // nobody having changed anything. Creation time then id breaks every tie
    // the same way every time.
    .orderBy(
      asc(lots.position),
      asc(lots.createdAt),
      asc(lots.id),
      desc(lotAssets.isPrimary),
      asc(lotAssets.position),
      asc(assets.contentHash),
    );

  const byLot = new Map<string, LotWithImages>();
  for (const row of rows) {
    let lot = byLot.get(row.id);
    if (!lot) {
      lot = {
        id: row.id,
        ref: row.ref,
        fields: row.fields,
        position: row.position,
        updatedAt: row.updatedAt,
        images: [],
      };
      byLot.set(row.id, lot);
    }
    if (row.hash) lot.images.push(row.hash);
  }
  return [...byLot.values()];
}

export interface LotChoice {
  id: string;
  ref: string | null;
  title: string;
  eventName: string;
  photoCount: number;
}

/**
 * Every lot in the org, flattened for a picker.
 *
 * ONE QUERY AND THE WHOLE SET, not a search endpoint. A house's sale is a few
 * hundred lots; sending them once lets the picker filter as the person types
 * with no round trip, which is the difference between assigning forty
 * photographs in a sitting and giving up. When a customer arrives with a
 * five-thousand-lot back catalogue this becomes a search endpoint, and the
 * component above it does not change shape.
 */
export async function listLotChoices(orgId: string): Promise<LotChoice[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: lots.id,
      ref: lots.ref,
      fields: lots.fields,
      eventName: events.name,
      position: lots.position,
      photoCount: sql<number>`(
        select count(*)::int from lot_assets where lot_assets.lot_id = lots.id
      )`,
    })
    .from(lots)
    .innerJoin(events, eq(events.id, lots.eventId))
    .where(eq(lots.orgId, orgId))
    .orderBy(events.name, lots.position)
    .limit(5000);

  return rows.map((r) => ({
    id: r.id,
    ref: r.ref,
    title: typeof r.fields?.title === "string"
      ? r.fields.title
      : ((r.fields?.title as { zh?: string; en?: string } | undefined)?.zh ??
         (r.fields?.title as { zh?: string; en?: string } | undefined)?.en ??
         ""),
    eventName: r.eventName,
    photoCount: Number(r.photoCount),
  }));
}

/** One lot, scoped. Both conditions, always. */
export async function getLot(
  orgId: string,
  lotId: string,
): Promise<typeof lots.$inferSelect | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(lots)
    .where(and(eq(lots.orgId, orgId), eq(lots.id, lotId)))
    .limit(1);
  return row ?? null;
}

/**
 * Change the RECORD.
 *
 * This is the edit that reaches every catalogue: a typo in a title is wrong
 * everywhere, not in one edition. What one catalogue prints differently is an
 * override (src/lib/data/overrides.ts) and is deliberately a different function
 * on a different table, so the two reaches cannot be confused by a caller.
 *
 * A key set to null or to blank is REMOVED, not stored as "". The caption
 * already skips an empty value, but `Object.keys(fields)` is what the lot page
 * and the matching screen read, and a field that is present-but-empty is a
 * field a person has to notice is empty.
 *
 * `ref` lives twice — as `lots.ref`, a column the list and the pins read, and
 * as `fields.ref`, which is where the importer wrote it (`applyMapping` keeps
 * every mapped column in `fields`). Both are set together or they drift, and
 * the lot's row and its caption would then disagree about its own number.
 *
 * The merge happens IN POSTGRES — `fields || patch` then `- removed` — so two
 * people saving two different fields of the same lot at the same moment both
 * land, instead of the second overwriting the first from a stale read.
 */
export async function updateLotFields(
  orgId: string,
  lotId: string,
  patch: Record<string, string | null>,
): Promise<typeof lots.$inferSelect | null> {
  const sets: Record<string, string> = {};
  const removed: string[] = [];
  for (const [key, raw] of Object.entries(patch)) {
    const value = raw?.trim() ?? "";
    if (value === "") removed.push(key);
    else sets[key] = value;
  }

  const db = getDb();
  // PgUpdateSetSource rather than Partial<$inferInsert>: the fields column is
  // being set to an SQL expression, which the insert shape does not admit.
  const change: PgUpdateSetSource<typeof lots> = { updatedAt: new Date() };
  if (Object.keys(sets).length > 0 || removed.length > 0) {
    // `sql.param`, not a bare interpolation: drizzle expands a JS array in a
    // template into `($1, $2)`, a list, and Postgres wants one text[] value.
    change.fields = sql`(${lots.fields} || ${JSON.stringify(sets)}::jsonb) - ${sql.param(removed)}::text[]`;
  }
  if ("ref" in patch) change.ref = sets.ref ?? null;

  const [row] = await db
    .update(lots)
    .set(change)
    .where(and(eq(lots.orgId, orgId), eq(lots.id, lotId)))
    .returning();
  return row ?? null;
}
