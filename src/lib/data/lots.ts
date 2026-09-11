// Writing lots, and reading them back.

import { and, asc, eq } from "drizzle-orm";

import { getDb, lots } from "@/db";
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
