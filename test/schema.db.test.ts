// Behaviour of the schema against a real Postgres.
//
// THIS TEST FAILS WITHOUT A DATABASE, AND THAT IS THE POINT. The predecessor's
// database-backed suites self-skipped when Postgres was unreachable, which
// removed roughly 121 tests while the summary line stayed green — a suite that
// disappears is worse than one that goes red, because nobody looks for it.
//
// Run `docker compose up -d && npm run db:migrate` first. CI provides the same
// database as a service container for the same reason.
//
// The structural tests next door prove the schema's SHAPE. These prove that the
// constraints actually behave: that one org cannot see another's rows by
// construction, that cascades reach everything, and that the keying rules hold
// when the database, not TypeScript, is the one enforcing them.

import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  assets,
  catalogues,
  events,
  getDb,
  getPool,
  lots,
  overrides,
  orgs,
  pinMembers,
  pins,
} from "@/db";

const db = getDb();

/** Two tenants, created fresh per run so a failed run cannot poison the next. */
let orgA: string;
let orgB: string;

async function makeOrg(label: string): Promise<string> {
  const [row] = await db
    .insert(orgs)
    .values({ name: label, slug: `${label}-${randomUUID().slice(0, 8)}` })
    .returning({ id: orgs.id });
  return row!.id;
}

beforeAll(async () => {
  orgA = await makeOrg("house-a");
  orgB = await makeOrg("house-b");
});

afterAll(async () => {
  // Deleting the orgs should remove everything this file created. That the
  // cleanup works at all is itself one of the assertions below.
  await db.delete(orgs).where(eq(orgs.id, orgA));
  await db.delete(orgs).where(eq(orgs.id, orgB));
  await getPool().end();
});

describe("tenants are isolated by construction", () => {
  it("two orgs may hold the same photograph without sharing a row", async () => {
    // ARCHITECTURE.md: assets are org-scoped even though the bytes are
    // content-addressed. Deduplication belongs in the storage layer, where it
    // saves space, and never in the table, where it would make one house's row
    // reachable from another house's query.
    const hash = `sha256:${randomUUID()}`;
    const common = { contentHash: hash, mimeType: "image/jpeg", byteSize: 1024 };

    await db.insert(assets).values({ ...common, orgId: orgA });
    await db.insert(assets).values({ ...common, orgId: orgB });

    const seenByA = await db
      .select()
      .from(assets)
      .where(and(eq(assets.orgId, orgA), eq(assets.contentHash, hash)));

    expect(seenByA).toHaveLength(1);
    expect(seenByA[0]!.orgId).toBe(orgA);
  });

  it("refuses the same content twice within one org", async () => {
    const hash = `sha256:${randomUUID()}`;
    const row = {
      orgId: orgA,
      contentHash: hash,
      mimeType: "image/jpeg",
      byteSize: 1,
    };
    await db.insert(assets).values(row);
    await expect(db.insert(assets).values(row)).rejects.toThrow();
  });
});

describe("corrections are keyed (catalogue, lot, field)", () => {
  it("permits one correction per field and refuses a second", async () => {
    const [event] = await db
      .insert(events)
      .values({ orgId: orgA, name: "Autumn Sale" })
      .returning({ id: events.id });
    const [lot] = await db
      .insert(lots)
      .values({ orgId: orgA, eventId: event!.id, ref: "P04" })
      .returning({ id: lots.id });
    const [catalogue] = await db
      .insert(catalogues)
      .values({ orgId: orgA, eventId: event!.id, name: "Autumn Sale Catalogue" })
      .returning({ id: catalogues.id });

    const key = {
      orgId: orgA,
      catalogueId: catalogue!.id,
      lotId: lot!.id,
      field: "images",
    };

    await db.insert(overrides).values({ ...key, value: { straightenDeg: -1.37 } });

    // The second write must be an update, not an insert — which is what the
    // unique index is for. A correction is one value per (lot, field), and two
    // rows would mean the engine had to pick.
    await expect(
      db.insert(overrides).values({ ...key, value: { straightenDeg: 0 } }),
    ).rejects.toThrow();

    const stored = await db
      .select()
      .from(overrides)
      .where(eq(overrides.lotId, lot!.id));
    expect(stored).toHaveLength(1);
    expect(stored[0]!.value).toEqual({ straightenDeg: -1.37 });
  });

  it("a pin holds members by (lot, field), so a density change cannot orphan it", async () => {
    const [event] = await db
      .insert(events)
      .values({ orgId: orgB, name: "Spring Sale" })
      .returning({ id: events.id });
    const [catalogue] = await db
      .insert(catalogues)
      .values({ orgId: orgB, eventId: event!.id, name: "Spring Catalogue" })
      .returning({ id: catalogues.id });
    const [lot] = await db
      .insert(lots)
      .values({ orgId: orgB, eventId: event!.id, ref: "S01" })
      .returning({ id: lots.id });
    const [pin] = await db
      .insert(pins)
      .values({ orgId: orgB, catalogueId: catalogue!.id })
      .returning({ id: pins.id });

    await db.insert(pinMembers).values({
      orgId: orgB,
      pinId: pin!.id,
      lotId: lot!.id,
      field: "images",
    });

    // The same member twice is a mistake, not a second membership.
    await expect(
      db.insert(pinMembers).values({
        orgId: orgB,
        pinId: pin!.id,
        lotId: lot!.id,
        field: "images",
      }),
    ).rejects.toThrow();
  });
});

describe("deleting a tenant reaches everything it owns", () => {
  it("cascades from org to event to lot to override", async () => {
    const doomed = await makeOrg("house-doomed");
    const [event] = await db
      .insert(events)
      .values({ orgId: doomed, name: "Doomed Sale" })
      .returning({ id: events.id });
    const [lot] = await db
      .insert(lots)
      .values({ orgId: doomed, eventId: event!.id })
      .returning({ id: lots.id });
    const [catalogue] = await db
      .insert(catalogues)
      .values({ orgId: doomed, eventId: event!.id, name: "Doomed" })
      .returning({ id: catalogues.id });
    await db.insert(overrides).values({
      orgId: doomed,
      catalogueId: catalogue!.id,
      lotId: lot!.id,
      field: "images",
      value: {},
    });

    await db.delete(orgs).where(eq(orgs.id, doomed));

    // If any of these survive, a deleted customer's data is still on disk —
    // which is a data-protection problem, not a tidiness one.
    expect(
      await db.select().from(events).where(eq(events.orgId, doomed)),
    ).toHaveLength(0);
    expect(
      await db.select().from(lots).where(eq(lots.orgId, doomed)),
    ).toHaveLength(0);
    expect(
      await db.select().from(overrides).where(eq(overrides.orgId, doomed)),
    ).toHaveLength(0);
  });
});
