// Photographs, and what they are attached to — which is frequently nothing.
//
// ── AN UNASSIGNED PHOTOGRAPH IS A NORMAL STATE, NOT AN INCOMPLETE ONE ────────
//
// This is the shape of the work, not a concession to it. A photographer shoots a
// consignment in one session and hands over four hundred files; the cataloguer
// works out which lot each belongs to over the following days, with the objects
// in front of them. A system that demands the assignment at the moment of upload
// makes the easy half of that job wait for the hard half, and the usual result
// is that the files never arrive at all and live in a shared drive instead.
//
// So `assets` has no lot column — the link is `lot_assets`, and its absence
// means "not yet", not "broken". Everything here is written so that the
// unassigned pile is a first-class view a person can work through, the way a
// receiving bay is a first-class place in a warehouse.

import { and, desc, eq, inArray, sql } from "drizzle-orm";

import { assets, getDb, lotAssets, lots } from "@/db";

export interface AssetRow {
  id: string;
  contentHash: string;
  mimeType: string;
  byteSize: number;
  originalName: string | null;
  geometry: Record<string, unknown> | null;
  createdAt: Date;
  /** How many lots use it. Zero is fine and expected. */
  useCount: number;
}

export type AssetFilter = "all" | "unassigned" | "assigned";

/**
 * Is this photograph on a lot? As SQL, once.
 *
 * Written out rather than derived from a join, for the reason the count below
 * gives: two of these are needed — one for the listing's WHERE and one inside
 * the counting query's FILTER — and a single expression is what keeps the
 * library's tab counts describing the rows the library will actually show.
 */
const ON_A_LOT = sql`exists (select 1 from lot_assets where lot_assets.asset_id = assets.id)`;

/**
 * Does this photograph's filename contain what was typed?
 *
 * ILIKE with the term escaped, because `%` and `_` are wildcards there and a
 * filename routinely contains an underscore — `IMG_4471.CR2` searched raw
 * would match `IMGx4471`, which is not wrong often enough for anybody to
 * notice and is wrong. `originalName` is nullable and a NULL never matches,
 * which is the right answer: a file the browser sent with no name cannot be
 * found by a name.
 *
 * src/lib/photographs.ts says why the filename is the only thing to search.
 */
function named(q: string) {
  const term = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  return sql`${assets.originalName} ilike ${term} escape '\\'`;
}

export async function listAssets(
  orgId: string,
  options: {
    filter?: AssetFilter;
    /** A substring of the original filename. "" or absent for all of them. */
    q?: string;
    limit?: number;
    offset?: number;
  } = {},
): Promise<AssetRow[]> {
  const db = getDb();
  const filter = options.filter ?? "all";
  const q = options.q?.trim() ?? "";

  // The count is a correlated subquery with the table and column names WRITTEN
  // OUT. Interpolating drizzle columns into a `sql` template renders them
  // unqualified, so both names resolve against the inner table, the condition is
  // never true and every count comes back zero — silently. That exact bug
  // shipped in the predecessor's event counts and is documented at length in
  // src/lib/data/events.ts; it is not repeated here.
  const useCount = sql<number>`(
    select count(*)::int from lot_assets where lot_assets.asset_id = assets.id
  )`;

  const rows = await db
    .select({
      id: assets.id,
      contentHash: assets.contentHash,
      mimeType: assets.mimeType,
      byteSize: assets.byteSize,
      originalName: assets.originalName,
      geometry: assets.geometry,
      createdAt: assets.createdAt,
      useCount,
    })
    .from(assets)
    .where(and(eq(assets.orgId, orgId), ...narrow(filter, q)))
    // NEWEST FIRST, AND NOW IT HAS TO BE TOTAL. The pile a person is working
    // through is the one that just arrived, which is why this order; what is
    // new is that the library pages, and a page is only meaningful if the
    // order is. Two photographs uploaded in the same folder share a
    // `created_at` to the microsecond often enough — the upload route writes
    // them in one pass — and two rows the database may return either way
    // round means a tile can appear on page two AND page three, or on
    // neither. The content hash breaks the tie: it is unique per org, it is
    // indexed, and it does not change.
    .orderBy(desc(assets.createdAt), assets.contentHash)
    .limit(options.limit ?? 500)
    .offset(options.offset ?? 0);

  return rows.map((r) => ({ ...r, useCount: Number(r.useCount) }));
}

/** The conditions beyond the org, as a list so `and()` can take none of them. */
function narrow(filter: AssetFilter, q: string) {
  const where = [];
  if (filter === "unassigned") where.push(sql`not ${ON_A_LOT}`);
  if (filter === "assigned") where.push(ON_A_LOT);
  if (q !== "") where.push(named(q));
  return where;
}

/**
 * The library's three tab counts, over what the search left.
 *
 * ONE QUERY AND THREE NUMBERS. Three counting queries would be three scans of
 * the same rows, and — worse — three chances for the tabs to describe a
 * different set from the one the listing shows. `filter` inside the aggregate
 * is how Postgres says this in one pass.
 *
 * THE SEARCH IS APPLIED FIRST, which is the ledger's rule and the same reason:
 * a tab reading "12" that lands on an empty grid is the defect a faceted count
 * exists to prevent. What the tab says is what pressing it gives.
 */
export async function countLibrary(
  orgId: string,
  q = "",
): Promise<{ all: number; unassigned: number; assigned: number }> {
  const db = getDb();
  const term = q.trim();
  const [row] = await db
    .select({
      all: sql<number>`count(*)::int`,
      unassigned: sql<number>`count(*) filter (where not ${ON_A_LOT})::int`,
      assigned: sql<number>`count(*) filter (where ${ON_A_LOT})::int`,
    })
    .from(assets)
    .where(term === "" ? eq(assets.orgId, orgId) : and(eq(assets.orgId, orgId), named(term)));

  return {
    all: Number(row?.all ?? 0),
    unassigned: Number(row?.unassigned ?? 0),
    assigned: Number(row?.assigned ?? 0),
  };
}

/**
 * The house's totals, for the chrome.
 *
 * KEPT SEPARATE FROM `countLibrary`, which answers the same question about a
 * SEARCH. This one is the root layout's — the rail's Photographs count and its
 * unassigned badge (src/app/layout.tsx) — and it is asked on every request of
 * every page, so it stays the narrowest query that answers it.
 */
export async function countAssets(
  orgId: string,
): Promise<{ total: number; unassigned: number }> {
  const db = getDb();
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      unassigned: sql<number>`count(*) filter (
        where not exists (select 1 from lot_assets where lot_assets.asset_id = assets.id)
      )::int`,
    })
    .from(assets)
    .where(eq(assets.orgId, orgId));
  return {
    total: Number(row?.total ?? 0),
    unassigned: Number(row?.unassigned ?? 0),
  };
}

/**
 * Record an uploaded photograph.
 *
 * Keyed on `(org_id, content_hash)`, so the same file arriving twice — which is
 * ordinary, a photographer re-sending a folder — is one row rather than a
 * duplicate the cataloguer has to notice and clean up. The row that comes back
 * is the one that is there, whether this call created it or not.
 */
export async function recordAsset(
  orgId: string,
  input: {
    contentHash: string;
    mimeType: string;
    byteSize: number;
    originalName: string | null;
    geometry: Record<string, unknown> | null;
  },
): Promise<{ id: string; created: boolean }> {
  const db = getDb();
  const inserted = await db
    .insert(assets)
    .values({ orgId, ...input })
    .onConflictDoNothing({ target: [assets.orgId, assets.contentHash] })
    .returning({ id: assets.id });

  if (inserted[0]) return { id: inserted[0].id, created: true };

  const [existing] = await db
    .select({ id: assets.id })
    .from(assets)
    .where(and(eq(assets.orgId, orgId), eq(assets.contentHash, input.contentHash)))
    .limit(1);
  return { id: existing!.id, created: false };
}

export async function listAssetsForLot(
  orgId: string,
  lotId: string,
): Promise<AssetRow[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: assets.id,
      contentHash: assets.contentHash,
      mimeType: assets.mimeType,
      byteSize: assets.byteSize,
      originalName: assets.originalName,
      geometry: assets.geometry,
      createdAt: assets.createdAt,
      isPrimary: lotAssets.isPrimary,
      position: lotAssets.position,
    })
    .from(lotAssets)
    .innerJoin(assets, eq(assets.id, lotAssets.assetId))
    .where(and(eq(lotAssets.orgId, orgId), eq(lotAssets.lotId, lotId)))
    .orderBy(desc(lotAssets.isPrimary), lotAssets.position, assets.contentHash);

  return rows.map((r) => ({ ...r, useCount: 1 }));
}

/**
 * Every plate in one sale, measured — by lot id.
 *
 * ── WHY THIS IS NOT `listAssetsForLot` IN A LOOP ────────────────────────────
 *
 * The editor mounts the polish panel over a document of 100–300 lots and the
 * panel reads a measurement the moment a plate is selected, so the page has to
 * carry all of them. Per lot that is one round trip each, which is the shape of
 * query that makes a screen feel fine on the seeded sale and unusable on a real
 * one. One join, one pass, and the primary only — a treatment is about the
 * plate, and the plate is `is_primary`.
 *
 * ── A LOT WITH NO MEASUREMENT IS STILL IN THE MAP ───────────────────────────
 *
 * `assets.geometry` is nullable on purpose (the upload route stores a file it
 * could not measure rather than refusing it), so a plate can exist and have no
 * numbers. The value is then null and the KEY is still present — which is how
 * the caller tells "this lot has no photograph" from "this lot has one nobody
 * could measure", two states the panel says different sentences about.
 */
export async function plateGeometry(
  orgId: string,
  eventId: string,
): Promise<Map<string, { width: number; height: number } | null>> {
  const db = getDb();
  const rows = await db
    .select({ lotId: lotAssets.lotId, geometry: assets.geometry })
    .from(lotAssets)
    .innerJoin(assets, eq(assets.id, lotAssets.assetId))
    .innerJoin(lots, eq(lots.id, lotAssets.lotId))
    .where(
      and(
        eq(lotAssets.orgId, orgId),
        eq(lots.eventId, eventId),
        eq(lotAssets.isPrimary, true),
      ),
    );

  const out = new Map<string, { width: number; height: number } | null>();
  for (const row of rows) {
    const width = Number(row.geometry?.width);
    const height = Number(row.geometry?.height);
    out.set(
      row.lotId,
      width > 0 && height > 0 ? { width, height } : null,
    );
  }
  return out;
}

/**
 * Attach photographs to a lot.
 *
 * Both ids are checked against the org before anything is written — an id alone
 * is not an authorisation, and this endpoint takes two of them from a request.
 * Returns how many links were made; a photograph already on the lot is not an
 * error, it is a person clicking twice.
 */
export async function attachAssets(
  orgId: string,
  lotId: string,
  assetIds: string[],
): Promise<number> {
  if (assetIds.length === 0) return 0;
  const db = getDb();

  const [lot] = await db
    .select({ id: lots.id })
    .from(lots)
    .where(and(eq(lots.orgId, orgId), eq(lots.id, lotId)))
    .limit(1);
  if (!lot) return 0;

  const owned = await db
    .select({ id: assets.id })
    .from(assets)
    .where(and(eq(assets.orgId, orgId), inArray(assets.id, assetIds)));
  if (owned.length === 0) return 0;

  const [existing] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(lotAssets)
    .where(and(eq(lotAssets.orgId, orgId), eq(lotAssets.lotId, lotId)));
  const already = Number(existing?.n ?? 0);

  const rows = await db
    .insert(lotAssets)
    .values(
      owned.map((asset, index) => ({
        orgId,
        lotId,
        assetId: asset.id,
        position: already + index,
        // The FIRST photograph on a lot is its plate, because a lot with one
        // photograph and no primary renders no plate at all — and "set a
        // primary" is not a step anybody should have to know about to see their
        // own picture.
        isPrimary: already === 0 && index === 0,
      })),
    )
    .onConflictDoNothing({ target: [lotAssets.lotId, lotAssets.assetId] })
    .returning({ id: lotAssets.id });

  return rows.length;
}

export async function detachAsset(
  orgId: string,
  lotId: string,
  assetId: string,
): Promise<boolean> {
  const db = getDb();
  const rows = await db
    .delete(lotAssets)
    .where(
      and(
        eq(lotAssets.orgId, orgId),
        eq(lotAssets.lotId, lotId),
        eq(lotAssets.assetId, assetId),
      ),
    )
    .returning({ id: lotAssets.id });

  if (rows.length === 0) return false;

  // Detaching the plate leaves the lot with photographs and nothing to print.
  // The next one in order takes over rather than the lot silently losing its
  // picture.
  const remaining = await db
    .select({ id: lotAssets.id, isPrimary: lotAssets.isPrimary })
    .from(lotAssets)
    .where(and(eq(lotAssets.orgId, orgId), eq(lotAssets.lotId, lotId)))
    .orderBy(lotAssets.position);
  if (remaining.length > 0 && !remaining.some((r) => r.isPrimary)) {
    await db
      .update(lotAssets)
      .set({ isPrimary: true })
      .where(eq(lotAssets.id, remaining[0]!.id));
  }
  return true;
}

export async function setPrimaryAsset(
  orgId: string,
  lotId: string,
  assetId: string,
): Promise<boolean> {
  const db = getDb();
  const cleared = await db
    .update(lotAssets)
    .set({ isPrimary: false })
    .where(and(eq(lotAssets.orgId, orgId), eq(lotAssets.lotId, lotId)))
    .returning({ id: lotAssets.id });
  if (cleared.length === 0) return false;

  const rows = await db
    .update(lotAssets)
    .set({ isPrimary: true })
    .where(
      and(
        eq(lotAssets.orgId, orgId),
        eq(lotAssets.lotId, lotId),
        eq(lotAssets.assetId, assetId),
      ),
    )
    .returning({ id: lotAssets.id });
  return rows.length > 0;
}
