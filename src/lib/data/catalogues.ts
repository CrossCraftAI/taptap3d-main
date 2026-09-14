// Catalogues: an output of an event, and a child of it. And the pins that say
// which of its arrangements must survive re-derivation.

import { and, asc, eq, inArray } from "drizzle-orm";

import { catalogues, getDb, lots, pinMembers, pins } from "@/db";
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
  const existing = await getCatalogue(orgId, eventId);
  if (existing) return existing;

  const db = getDb();
  const [created] = await db
    .insert(catalogues)
    .values({ orgId, eventId, name })
    .returning();
  return created!;
}

/**
 * The event's catalogue if it has one — and nothing is created if it has not.
 *
 * The lot page needs this: it shows how THIS catalogue prints the lot, but a lot
 * page is not a request for a catalogue, and an event whose catalogue appeared
 * because somebody looked at a lot has a catalogue nobody asked for.
 */
export async function getCatalogue(
  orgId: string,
  eventId: string,
): Promise<typeof catalogues.$inferSelect | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(catalogues)
    .where(and(eq(catalogues.orgId, orgId), eq(catalogues.eventId, eventId)))
    .orderBy(asc(catalogues.createdAt))
    .limit(1);
  return row ?? null;
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
 * Say the catalogue's presentation changed.
 *
 * The preview frame reloads only when its `src` changes, and the page keys that
 * on the catalogue's `updated_at`. A pin or an override changes what the
 * catalogue looks like without touching its row, so the writers bump it here —
 * the alternative, hashing every pin and override into the key on each render,
 * is more work every time somebody looks than this is every time somebody acts.
 */
export async function touchCatalogue(
  orgId: string,
  catalogueId: string,
): Promise<void> {
  const db = getDb();
  await db
    .update(catalogues)
    .set({ updatedAt: new Date() })
    .where(and(eq(catalogues.orgId, orgId), eq(catalogues.id, catalogueId)));
}

/**
 * Record that the catalogue's PDF was taken.
 *
 * Called by the print route on a successful render and by nothing else. It is
 * the fact the workflow reads as "exported" (src/lib/workflow.ts), and the
 * only fact about a sale that nothing else in the schema already implied.
 *
 * It does NOT touch `updated_at`. That column keys the preview frame and the
 * pin panel, and an export changes nothing about the document — bumping it
 * would reload a preview nobody changed.
 */
export async function markExported(
  orgId: string,
  catalogueId: string,
): Promise<void> {
  const db = getDb();
  await db
    .update(catalogues)
    .set({ exportedAt: new Date() })
    .where(and(eq(catalogues.orgId, orgId), eq(catalogues.id, catalogueId)));
}

// ── Pins ────────────────────────────────────────────────────────────────────

/** A pin as stored: the engine's shape plus the id a person needs to remove it. */
export interface PinRow extends EnginePin {
  id: string;
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
): Promise<PinRow[]> {
  const db = getDb();
  const rows = await db
    .select({
      pinId: pins.id,
      keepsTogether: pins.keepsTogether,
      lotId: pinMembers.lotId,
      position: lots.position,
    })
    .from(pins)
    .leftJoin(pinMembers, eq(pinMembers.pinId, pins.id))
    .leftJoin(lots, eq(lots.id, pinMembers.lotId))
    .where(and(eq(pins.orgId, orgId), eq(pins.catalogueId, catalogueId)))
    // Members in the sale's own order, so a pin reads P03 · P04 and not the
    // other way round depending on which row the join returned first.
    .orderBy(asc(pins.createdAt), asc(lots.position), asc(pinMembers.createdAt));

  const byPin = new Map<string, PinRow>();
  for (const row of rows) {
    let pin = byPin.get(row.pinId);
    if (!pin) {
      pin = { id: row.pinId, keepsTogether: row.keepsTogether, lotIds: [] };
      byPin.set(row.pinId, pin);
    }
    if (row.lotId && !pin.lotIds.includes(row.lotId)) pin.lotIds.push(row.lotId);
  }
  return [...byPin.values()].filter((p) => p.lotIds.length > 0);
}

export type PinResult = { ok: true; id: string } | { ok: false; reason: string };

/**
 * Pin lots together so re-derivation keeps them on one page.
 *
 * KEYED BY MEMBERS. Every member is written as `(lot, 'placement')` — the same
 * field name the migration used for the predecessor's spreads — and nothing
 * about which page they were on when the specialist chose them is recorded,
 * because that page will not exist at the next density.
 *
 * Two refusals, both because the engine would otherwise accept the pin and do
 * NOTHING with it, which is worse than saying no:
 *
 * - The members must be neighbours in the sale's order. The engine keeps
 *   together runs of CONSECUTIVE lots; a pin of P01 and P09 is a pin of two
 *   runs of one, and the person who made it would discover that at the printer.
 *   Reordering lots is not built, so a pin cannot yet bring them together.
 * - A lot may sit in one keeping-together pin. Two would be a contradiction the
 *   engine resolves by letting the first win, silently.
 *
 * Contiguity is judged by ORDER, not by comparing `position` values: two imports
 * into one event both number from zero, so positions alone would call two
 * neighbours non-adjacent.
 */
export async function createPin(
  orgId: string,
  catalogueId: string,
  lotIds: string[],
): Promise<PinResult> {
  const wanted = [...new Set(lotIds)];
  if (wanted.length < 2) {
    return { ok: false, reason: "A pin needs at least two lots." };
  }

  const db = getDb();
  const [catalogue] = await db
    .select({ eventId: catalogues.eventId })
    .from(catalogues)
    .where(and(eq(catalogues.orgId, orgId), eq(catalogues.id, catalogueId)))
    .limit(1);
  if (!catalogue) return { ok: false, reason: "That catalogue is not yours." };

  const ordered = await db
    .select({ id: lots.id, ref: lots.ref })
    .from(lots)
    .where(and(eq(lots.orgId, orgId), eq(lots.eventId, catalogue.eventId)))
    .orderBy(asc(lots.position), asc(lots.createdAt), asc(lots.id));
  const indexOf = new Map(ordered.map((lot, index) => [lot.id, index]));

  const indices = wanted.map((id) => indexOf.get(id));
  if (indices.some((i) => i === undefined)) {
    return { ok: false, reason: "One of those lots is not in this sale." };
  }
  const sorted = (indices as number[]).sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i]! !== sorted[i - 1]! + 1) {
      return {
        ok: false,
        reason:
          "Pinned lots must be neighbours in the sale's order. " +
          "Reordering is not built yet, so a pin cannot bring them together.",
      };
    }
  }

  const taken = await db
    .select({ lotId: pinMembers.lotId })
    .from(pinMembers)
    .innerJoin(pins, eq(pins.id, pinMembers.pinId))
    .where(
      and(
        eq(pins.orgId, orgId),
        eq(pins.catalogueId, catalogueId),
        eq(pins.keepsTogether, true),
        inArray(pinMembers.lotId, wanted),
      ),
    );
  if (taken.length > 0) {
    const refs = taken
      .map((t) => ordered.find((l) => l.id === t.lotId)?.ref ?? "a lot")
      .join(", ");
    return {
      ok: false,
      reason: `${refs} is already pinned. Unpin it first.`,
    };
  }

  const [pin] = await db
    .insert(pins)
    .values({ orgId, catalogueId, keepsTogether: true })
    .returning({ id: pins.id });
  await db.insert(pinMembers).values(
    wanted.map((lotId) => ({ orgId, pinId: pin!.id, lotId, field: "placement" })),
  );
  await touchCatalogue(orgId, catalogueId);
  return { ok: true, id: pin!.id };
}

/** Unpin. The members re-derive like any other lot; nothing else changes. */
export async function deletePin(orgId: string, pinId: string): Promise<boolean> {
  const db = getDb();
  const rows = await db
    .delete(pins)
    .where(and(eq(pins.orgId, orgId), eq(pins.id, pinId)))
    .returning({ catalogueId: pins.catalogueId });
  if (rows.length === 0) return false;
  await touchCatalogue(orgId, rows[0]!.catalogueId);
  return true;
}
