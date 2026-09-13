// Catalogues: an output of an event, and a child of it.

import { and, asc, eq } from "drizzle-orm";

import { catalogues, getDb, pinMembers, pins } from "@/db";
import type { EnginePin } from "@/lib/engine/derive";

/**
 * The event's catalogue, created on first sight.
 *
 * An event may produce none, one or several (DFD.md §3) — a re-issue and a
 * two-session sale are both real. What an event may not do is produce one
 * SILENTLY at a moment nobody asked for it, so this is called from the catalogue
 * screen and nowhere else: opening the catalogue is the request.
 */
export async function ensureCatalogue(
  orgId: string,
  eventId: string,
  name = "Catalogue",
): Promise<typeof catalogues.$inferSelect> {
  const db = getDb();
  const [existing] = await db
    .select()
    .from(catalogues)
    .where(and(eq(catalogues.orgId, orgId), eq(catalogues.eventId, eventId)))
    .orderBy(asc(catalogues.createdAt))
    .limit(1);
  if (existing) return existing;

  const [created] = await db
    .insert(catalogues)
    .values({ orgId, eventId, name })
    .returning();
  return created!;
}

export async function updateCatalogueParams(
  orgId: string,
  catalogueId: string,
  params: Record<string, unknown>,
): Promise<void> {
  const db = getDb();
  await db
    .update(catalogues)
    .set({ params, updatedAt: new Date() })
    // Both, always — an id alone is not an authorisation.
    .where(and(eq(catalogues.orgId, orgId), eq(catalogues.id, catalogueId)));
}

/**
 * The catalogue's pins, as the engine wants them.
 *
 * A pin is keyed by its MEMBERS, so this reads the members and hands the engine
 * lot ids. Nothing here knows or cares which page anything landed on.
 */
export async function listPins(
  orgId: string,
  catalogueId: string,
): Promise<EnginePin[]> {
  const db = getDb();
  const rows = await db
    .select({
      pinId: pins.id,
      keepsTogether: pins.keepsTogether,
      lotId: pinMembers.lotId,
    })
    .from(pins)
    .leftJoin(pinMembers, eq(pinMembers.pinId, pins.id))
    .where(and(eq(pins.orgId, orgId), eq(pins.catalogueId, catalogueId)))
    .orderBy(asc(pins.createdAt));

  const byPin = new Map<string, EnginePin>();
  for (const row of rows) {
    let pin = byPin.get(row.pinId);
    if (!pin) {
      pin = { keepsTogether: row.keepsTogether, lotIds: [] };
      byPin.set(row.pinId, pin);
    }
    if (row.lotId && !pin.lotIds.includes(row.lotId)) pin.lotIds.push(row.lotId);
  }
  return [...byPin.values()].filter((p) => p.lotIds.length > 0);
}
