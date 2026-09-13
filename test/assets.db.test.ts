// Photographs and their attachment, against a real Postgres.
//
// The rules worth proving here are the ones a person only discovers when they
// are wrong in front of a customer: that an unassigned photograph is a normal
// row, that the first one attached becomes the plate without anyone being told
// to set it, and that removing the plate does not leave a lot with photographs
// and nothing to print.

import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getDb, getPool, lotAssets, orgs } from "@/db";
import {
  attachAssets,
  countAssets,
  detachAsset,
  listAssets,
  listAssetsForLot,
  recordAsset,
  setPrimaryAsset,
} from "@/lib/data/assets";
import { createEvent } from "@/lib/data/events";
import { insertLots, listLots } from "@/lib/data/lots";

const db = getDb();
let orgA: string;
let orgB: string;
let eventA: string;
let lotA: string;
let lotB: string;

const hash = (seed: string): string =>
  seed.padEnd(64, "0").slice(0, 64).replace(/[^0-9a-f]/g, "a");

async function makeOrg(label: string): Promise<string> {
  const [row] = await db
    .insert(orgs)
    .values({ name: label, slug: `${label}-${randomUUID().slice(0, 8)}` })
    .returning({ id: orgs.id });
  return row!.id;
}

async function store(orgId: string, seed: string): Promise<string> {
  const { id } = await recordAsset(orgId, {
    contentHash: hash(seed),
    mimeType: "image/jpeg",
    byteSize: 1234,
    originalName: `${seed}.jpg`,
    geometry: { width: 100, height: 80 },
  });
  return id;
}

beforeAll(async () => {
  orgA = await makeOrg("assets-a");
  orgB = await makeOrg("assets-b");
  const event = await createEvent(orgA, { name: "Photograph Sale" });
  eventA = event.id;
  await insertLots(orgA, eventA, [
    { ref: "L01", fields: { title: "First" }, sourceRow: 1 },
    { ref: "L02", fields: { title: "Second" }, sourceRow: 2 },
  ]);
  const lots = await listLots(orgA, eventA);
  lotA = lots[0]!.id;
  lotB = lots[1]!.id;
});

afterAll(async () => {
  await db.delete(orgs).where(eq(orgs.id, orgA));
  await db.delete(orgs).where(eq(orgs.id, orgB));
  await getPool().end();
});

describe("recordAsset", () => {
  it("holds the same bytes once per org", async () => {
    const first = await recordAsset(orgA, {
      contentHash: hash("dedupe"),
      mimeType: "image/jpeg",
      byteSize: 10,
      originalName: "a.jpg",
      geometry: null,
    });
    const second = await recordAsset(orgA, {
      contentHash: hash("dedupe"),
      mimeType: "image/jpeg",
      byteSize: 10,
      originalName: "a-copy.jpg",
      geometry: null,
    });
    expect(second.id).toBe(first.id);
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
  });

  it("gives two orgs their own row for identical bytes", async () => {
    // The blob is shared in the store, where that saves space. The ROW is never
    // shared, or one house's query reaches another house's holdings.
    const mine = await recordAsset(orgA, {
      contentHash: hash("shared"),
      mimeType: "image/jpeg",
      byteSize: 10,
      originalName: "s.jpg",
      geometry: null,
    });
    const theirs = await recordAsset(orgB, {
      contentHash: hash("shared"),
      mimeType: "image/jpeg",
      byteSize: 10,
      originalName: "s.jpg",
      geometry: null,
    });
    expect(theirs.id).not.toBe(mine.id);
  });
});

describe("the unassigned pile", () => {
  it("is a normal state, counted and listable", async () => {
    const id = await store(orgA, "loose");
    const unassigned = await listAssets(orgA, { filter: "unassigned" });
    expect(unassigned.map((a) => a.id)).toContain(id);
    expect(unassigned.every((a) => a.useCount === 0)).toBe(true);

    const counts = await countAssets(orgA);
    expect(counts.unassigned).toBeGreaterThan(0);
    expect(counts.total).toBeGreaterThanOrEqual(counts.unassigned);
  });

  it("never shows another org's photographs", async () => {
    await store(orgB, "theirs");
    const mine = await listAssets(orgA);
    expect(mine.every((a) => a.originalName !== "theirs.jpg")).toBe(true);
  });

  it("moves out of the pile once attached", async () => {
    const id = await store(orgA, "filed");
    await attachAssets(orgA, lotA, [id]);
    const unassigned = await listAssets(orgA, { filter: "unassigned" });
    expect(unassigned.map((a) => a.id)).not.toContain(id);
    const assigned = await listAssets(orgA, { filter: "assigned" });
    expect(assigned.map((a) => a.id)).toContain(id);
  });
});

describe("attaching", () => {
  it("makes the first photograph the plate without being asked", async () => {
    // A lot with one photograph and no primary renders no plate at all, and
    // "set a primary" is not a step anyone should need to know about to see
    // their own picture.
    const id = await store(orgA, "plate1");
    await attachAssets(orgA, lotB, [id]);
    const [first] = await listAssetsForLot(orgA, lotB);
    expect(first?.id).toBe(id);
    const rows = await db
      .select()
      .from(lotAssets)
      .where(eq(lotAssets.lotId, lotB));
    expect(rows.filter((r) => r.isPrimary)).toHaveLength(1);
  });

  it("does not make a second plate", async () => {
    const id = await store(orgA, "plate2");
    await attachAssets(orgA, lotB, [id]);
    const rows = await db
      .select()
      .from(lotAssets)
      .where(eq(lotAssets.lotId, lotB));
    expect(rows.filter((r) => r.isPrimary)).toHaveLength(1);
  });

  it("treats attaching twice as a person clicking twice", async () => {
    const id = await store(orgA, "twice");
    const first = await attachAssets(orgA, lotA, [id]);
    const second = await attachAssets(orgA, lotA, [id]);
    expect(first).toBe(1);
    expect(second).toBe(0);
  });

  it("refuses another org's photograph and another org's lot", async () => {
    // Two ids arrive from one request; an id is not an authorisation.
    const theirs = await store(orgB, "notyours");
    expect(await attachAssets(orgA, lotA, [theirs])).toBe(0);

    const mine = await store(orgA, "mineonly");
    expect(await attachAssets(orgB, lotA, [mine])).toBe(0);
  });
});

describe("detaching", () => {
  it("hands the plate to the next photograph rather than leaving none", async () => {
    const one = await store(orgA, "seq1");
    const two = await store(orgA, "seq2");
    const lot = (await listLots(orgA, eventA))[0]!.id;
    await attachAssets(orgA, lot, [one, two]);

    const before = await listAssetsForLot(orgA, lot);
    const plate = before.find((a) => a.id === one);
    expect(plate).toBeDefined();

    await detachAsset(orgA, lot, one);
    const rows = await db.select().from(lotAssets).where(eq(lotAssets.lotId, lot));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((r) => r.isPrimary)).toBe(true);
  });

  it("takes the photograph off the lot and leaves it in the library", async () => {
    const id = await store(orgA, "keepme");
    await attachAssets(orgA, lotB, [id]);
    await detachAsset(orgA, lotB, id);
    const all = await listAssets(orgA);
    expect(all.map((a) => a.id)).toContain(id);
  });

  it("says so when the photograph is not on the lot", async () => {
    const id = await store(orgA, "elsewhere");
    expect(await detachAsset(orgA, lotB, id)).toBe(false);
  });
});

describe("setPrimaryAsset", () => {
  it("moves the plate and leaves exactly one", async () => {
    const one = await store(orgA, "prim1");
    const two = await store(orgA, "prim2");
    const event = await createEvent(orgA, { name: "Primary Sale" });
    await insertLots(orgA, event.id, [
      { ref: "P1", fields: {}, sourceRow: 1 },
    ]);
    const lot = (await listLots(orgA, event.id))[0]!.id;
    await attachAssets(orgA, lot, [one, two]);

    expect(await setPrimaryAsset(orgA, lot, two)).toBe(true);
    const rows = await db.select().from(lotAssets).where(eq(lotAssets.lotId, lot));
    const primaries = rows.filter((r) => r.isPrimary);
    expect(primaries).toHaveLength(1);
    expect(primaries[0]!.assetId).toBe(two);
  });
});
