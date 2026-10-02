// The running order, written to a real Postgres.
//
// The pure half — which lots move together, and the pin that must survive it
// — is test/lot-order.ts. This is the half that can only be wrong against a
// database: that the renumbering is atomic, that it refuses an order it
// cannot trust, and that a second import appends instead of interleaving.
//
// Needs a database and says so by failing — see test/schema.db.test.ts on why
// there is no skip path anywhere in this suite.

import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getDb, getPool, orgs } from "@/db";
import { createEvent } from "@/lib/data/events";
import { insertLots, listLots, reorderLots } from "@/lib/data/lots";

const db = getDb();
let orgA: string;
let orgB: string;

async function makeOrg(label: string): Promise<string> {
  const [row] = await db
    .insert(orgs)
    .values({ name: label, slug: `${label}-${randomUUID().slice(0, 8)}` })
    .returning({ id: orgs.id });
  return row!.id;
}

/** A sale of `refs`, in that order, through the writer the importer uses. */
async function sale(orgId: string, refs: string[]): Promise<{ id: string; ids: string[] }> {
  const event = await createEvent(orgId, { name: `Order ${randomUUID().slice(0, 6)}` });
  await insertLots(
    orgId,
    event.id,
    refs.map((ref, i) => ({ ref, fields: { title: ref }, sourceRow: i + 2 })),
  );
  const ids = (await listLots(orgId, event.id)).map((lot) => lot.id);
  return { id: event.id, ids };
}

const refsOf = async (orgId: string, eventId: string): Promise<(string | null)[]> =>
  (await listLots(orgId, eventId)).map((lot) => lot.ref);

beforeAll(async () => {
  orgA = await makeOrg("order-a");
  orgB = await makeOrg("order-b");
});

afterAll(async () => {
  await db.delete(orgs).where(eq(orgs.id, orgA));
  await db.delete(orgs).where(eq(orgs.id, orgB));
  await getPool().end();
});

describe("writing the running order", () => {
  it("renumbers the whole sale, and the list reads back in that order", async () => {
    const { id, ids } = await sale(orgA, ["P01", "P02", "P03", "P04"]);
    expect(await refsOf(orgA, id)).toEqual(["P01", "P02", "P03", "P04"]);

    // Last to first — the gesture a specialist makes when they decide the
    // closing lot is actually the opener.
    const moved = [ids[3]!, ids[0]!, ids[1]!, ids[2]!];
    expect(await reorderLots(orgA, id, moved)).toBe(4);
    expect(await refsOf(orgA, id)).toEqual(["P04", "P01", "P02", "P03"]);
  });

  it("gives every lot a distinct position, so the order cannot be a tie-break", () => {
    // `listLots` orders by position, then created_at, then id. If a reorder
    // left two lots sharing a number, the sale would read in an order nobody
    // chose and would be stable enough to look deliberate.
    return (async () => {
      const { id, ids } = await sale(orgA, ["Q1", "Q2", "Q3"]);
      await reorderLots(orgA, id, [ids[2]!, ids[1]!, ids[0]!]);
      const positions = (await listLots(orgA, id)).map((lot) => lot.position);
      expect(new Set(positions).size).toBe(3);
      expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    })();
  });

  it("refuses an order that is missing a lot, rather than applying half of it", async () => {
    // THE REAL CASE: the browser builds this list from the rows on screen,
    // and somebody else added a lot a moment ago. Applying it would leave the
    // newcomer colliding with whatever took its number.
    const { id, ids } = await sale(orgA, ["R1", "R2", "R3"]);
    expect(await reorderLots(orgA, id, [ids[1]!, ids[0]!])).toBeNull();
    expect(await refsOf(orgA, id)).toEqual(["R1", "R2", "R3"]);
  });

  it("refuses an order carrying a lot twice", async () => {
    const { id, ids } = await sale(orgA, ["S1", "S2"]);
    expect(await reorderLots(orgA, id, [ids[0]!, ids[0]!])).toBeNull();
    expect(await refsOf(orgA, id)).toEqual(["S1", "S2"]);
  });

  it("refuses an order carrying another sale's lot, and writes nothing", async () => {
    const mine = await sale(orgA, ["T1", "T2"]);
    const theirs = await sale(orgA, ["U1", "U2"]);
    expect(await reorderLots(orgA, mine.id, [mine.ids[0]!, theirs.ids[0]!])).toBeNull();
    expect(await refsOf(orgA, mine.id)).toEqual(["T1", "T2"]);
    expect(await refsOf(orgA, theirs.id)).toEqual(["U1", "U2"]);
  });

  it("refuses across orgs — an id is not an authorisation", async () => {
    const { id, ids } = await sale(orgB, ["V1", "V2"]);
    expect(await reorderLots(orgA, id, [ids[1]!, ids[0]!])).toBeNull();
    expect(await refsOf(orgB, id)).toEqual(["V1", "V2"]);
  });
});

describe("a second import appends", () => {
  /**
   * THE BUG THIS WAS WRITTEN FOR. `insertLots` numbered every import from
   * zero, so a house importing the ceramics and then the paintings got two
   * lots at position 0, two at 1, and an order decided by the tie-break. It
   * was invisible for as long as nobody could change the order and see that
   * it was wrong.
   */
  it("after the lots already there, not interleaved among them", async () => {
    const { id } = await sale(orgA, ["W1", "W2", "W3"]);
    await insertLots(orgA, id, [
      { ref: "W4", fields: { title: "W4" }, sourceRow: 2 },
      { ref: "W5", fields: { title: "W5" }, sourceRow: 3 },
    ]);
    expect(await refsOf(orgA, id)).toEqual(["W1", "W2", "W3", "W4", "W5"]);
    const positions = (await listLots(orgA, id)).map((lot) => lot.position);
    expect(positions).toEqual([0, 1, 2, 3, 4]);
  });

  it("and appends after a reorder, not after the original numbering", async () => {
    // The maximum is read at insert time, so an import into a sale somebody
    // has already re-sequenced still lands at the end of it.
    const { id, ids } = await sale(orgA, ["X1", "X2"]);
    await reorderLots(orgA, id, [ids[1]!, ids[0]!]);
    await insertLots(orgA, id, [{ ref: "X3", fields: { title: "X3" }, sourceRow: 2 }]);
    expect(await refsOf(orgA, id)).toEqual(["X2", "X1", "X3"]);
  });
});
