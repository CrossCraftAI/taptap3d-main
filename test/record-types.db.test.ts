// A record type on a lot, against a real Postgres.
//
// The vocabulary and the reader are exercised in node (test/record-types.ts).
// What only a database can say is that the column survives the round trip,
// that a type a house later deletes leaves its lots READABLE rather than
// broken, and that an import without a type writes null — which is every
// import in every database today.
//
// Needs a database and says so by failing — see test/schema.db.test.ts on why
// there is no skip path anywhere in this suite.

import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getDb, getPool, orgs } from "@/db";
import { createEvent } from "@/lib/data/events";
import { insertLots, listLots } from "@/lib/data/lots";
import { recordTypesOf, setFieldPolicy } from "@/lib/data/org";
import { complaints, recordTypeOf } from "@/lib/record-types";

const db = getDb();
let orgId: string;

beforeAll(async () => {
  const [row] = await db
    .insert(orgs)
    .values({ name: "Types", slug: `types-${randomUUID().slice(0, 8)}` })
    .returning({ id: orgs.id });
  orgId = row!.id;
});

afterAll(async () => {
  await db.delete(orgs).where(eq(orgs.id, orgId));
  await getPool().end();
});

/** What a house's authoring screen will one day write. */
const WATCH = {
  watch: {
    name: { zh: "腕錶", en: "Watch" },
    properties: [
      { key: "機芯", label: { zh: "機芯", en: "Calibre" }, type: "text", required: true },
      { key: "品相", label: { zh: "品相", en: "Condition" }, type: "select", options: ["A", "B"] },
    ],
  },
};

describe("a house's record types", () => {
  it("are empty until the house defines some, which is every house today", async () => {
    expect(await recordTypesOf(orgId)).toEqual({});
  });

  it("read back as the house wrote them", async () => {
    await db.update(orgs).set({ recordTypes: WATCH }).where(eq(orgs.id, orgId));
    const types = await recordTypesOf(orgId);
    expect(Object.keys(types)).toEqual(["watch"]);
    expect(types.watch!.properties.map((p) => p.key)).toEqual(["機芯", "品相"]);
  });

  it("do not disturb the field policy beside them", async () => {
    // Two per-org jsonb columns governing different things about one field —
    // who may see it, and what it may be. A writer of one must not clear the
    // other, which a careless `set({ ... })` on the whole row would.
    await setFieldPolicy(orgId, { "保留價": "house" });
    const types = await recordTypesOf(orgId);
    expect(Object.keys(types)).toEqual(["watch"]);
  });
});

describe("a lot of a kind", () => {
  it("keeps the type it was imported as", async () => {
    const event = await createEvent(orgId, { name: "Watch Sale" });
    await insertLots(
      orgId,
      event.id,
      [{ ref: "W1", fields: { "機芯": "Cal. 324", "品相": "A" }, sourceRow: 2 }],
      { recordType: "watch" },
    );
    const [lot] = await listLots(orgId, event.id);
    expect(lot!.recordType).toBe("watch");

    const types = await recordTypesOf(orgId);
    expect(complaints(recordTypeOf(types, lot!.recordType)!, lot!.fields)).toEqual([]);
  });

  it("is of no particular kind when an import names none", async () => {
    // Every import in every database today, and it stays the honest default.
    const event = await createEvent(orgId, { name: "Ordinary Sale" });
    await insertLots(orgId, event.id, [{ ref: "O1", fields: {}, sourceRow: 2 }]);
    const [lot] = await listLots(orgId, event.id);
    expect(lot!.recordType).toBeNull();
    expect(recordTypeOf(await recordTypesOf(orgId), lot!.recordType)).toBeNull();
  });

  /**
   * THE REASON THE COLUMN IS TEXT AND NOT A FOREIGN KEY. The types live in
   * jsonb on the org, so nothing stops a house deleting one that lots still
   * name. Those lots must stay readable: the record is the house's work and a
   * schema change is not a reason to lose it.
   */
  it("stays readable when the house deletes the type it names", async () => {
    const event = await createEvent(orgId, { name: "Orphan Sale" });
    await insertLots(orgId, event.id, [{ ref: "P1", fields: { a: "b" }, sourceRow: 2 }], {
      recordType: "watch",
    });
    await db.update(orgs).set({ recordTypes: {} }).where(eq(orgs.id, orgId));

    const [lot] = await listLots(orgId, event.id);
    expect(lot!.recordType).toBe("watch");
    expect(lot!.fields).toEqual({ a: "b" });
    // Reads as untyped, which is what `recordTypeOf` answers for an id it
    // does not recognise — no throw, no empty record, no lost values.
    expect(recordTypeOf(await recordTypesOf(orgId), lot!.recordType)).toBeNull();
  });
});
