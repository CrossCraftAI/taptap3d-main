// Writing lots, and reading them back.

import { and, asc, desc, eq } from "drizzle-orm";

import { assets, getDb, lotAssets, lots } from "@/db";
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
    .orderBy(asc(lots.position));
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
      hash: assets.contentHash,
      isPrimary: lotAssets.isPrimary,
      assetPosition: lotAssets.position,
    })
    .from(lots)
    .leftJoin(lotAssets, eq(lotAssets.lotId, lots.id))
    .leftJoin(assets, eq(assets.id, lotAssets.assetId))
    .where(and(eq(lots.orgId, orgId), eq(lots.eventId, eventId)))
    .orderBy(
      asc(lots.position),
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
        images: [],
      };
      byLot.set(row.id, lot);
    }
    if (row.hash) lot.images.push(row.hash);
  }
  return [...byLot.values()];
}
