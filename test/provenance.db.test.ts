// Where a lot came from, against a real Postgres.
//
// `import_runs` had a writer and no reader for as long as it has existed, and
// it was EVENT-grained: it could say what was imported into a sale and never
// which run produced which lot. `drizzle/0006` added `lots.import_run_id` and
// `lots.source_row`, and this is the suite that holds the answer to account —
// including the two cases that are not a run at all, because "we do not know"
// and "it came from nowhere" have to stay distinguishable.
//
// Needs a database and says so by failing — see test/schema.db.test.ts on why
// there is no skip path anywhere in this suite.

import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getDb, getPool, importRuns, lots, orgs } from "@/db";
import { createEvent } from "@/lib/data/events";
import { importRunOf, insertLots, listLots } from "@/lib/data/lots";

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

async function makeRun(
  orgId: string,
  eventId: string,
  over: Partial<typeof importRuns.$inferInsert> = {},
): Promise<string> {
  const [row] = await db
    .insert(importRuns)
    .values({
      orgId,
      eventId,
      sourceFilename: "spring-2026-ceramics.xlsx",
      sourceFormat: "xlsx",
      mapping: [
        { kind: "core", field: "ref" },
        { kind: "core", field: "title" },
        { kind: "custom", name: "保留價" },
        { kind: "skip" },
      ],
      rowCount: 160,
      lotCount: 2,
      warnings: ["Two rows had no 編號."],
      ...over,
    })
    .returning({ id: importRuns.id });
  return row!.id;
}

beforeAll(async () => {
  orgA = await makeOrg("prov-a");
  orgB = await makeOrg("prov-b");
});

afterAll(async () => {
  await db.delete(orgs).where(eq(orgs.id, orgA));
  await db.delete(orgs).where(eq(orgs.id, orgB));
  await getPool().end();
});

describe("a lot's import", () => {
  it("names the file, the row of it and the mapping a person cleared", async () => {
    const event = await createEvent(orgA, { name: "Provenance Sale" });
    const runId = await makeRun(orgA, event.id);
    await insertLots(
      orgA,
      event.id,
      [
        { ref: "P01", fields: { title: "青花梅瓶" }, sourceRow: 8 },
        { ref: "P02", fields: { title: "山水四屏" }, sourceRow: 47 },
      ],
      { importRunId: runId },
    );

    const [first, second] = await listLots(orgA, event.id);
    const answer = await importRunOf(orgA, second!.id);

    // THE ROW IN THEIR FILE, NOT OUR INDEX. `P02` is position 1 and row 47,
    // and 47 is the number a registrar can find when they open the
    // spreadsheet to check what this lot was supposed to say.
    expect(answer?.sourceRow).toBe(47);
    expect(answer?.run?.filename).toBe("spring-2026-ceramics.xlsx");
    expect(answer?.run?.format).toBe("xlsx");
    expect(answer?.run?.rowCount).toBe(160);
    expect(answer?.run?.warnings).toEqual(["Two rows had no 編號."]);
    expect(answer?.run?.mapping).toHaveLength(4);
    expect(answer?.run?.importedAt).toBeInstanceOf(Date);

    // Both lots point at the same run, and each keeps its own row.
    expect((await importRunOf(orgA, first!.id))?.sourceRow).toBe(8);
    expect((await importRunOf(orgA, first!.id))?.run?.id).toBe(runId);
  });

  it("says NOT RECORDED for a lot written without a run, and still says the lot exists", async () => {
    const event = await createEvent(orgA, { name: "Unattributed Sale" });
    await insertLots(orgA, event.id, [{ ref: "X1", fields: {}, sourceRow: 3 }]);
    const [lot] = await listLots(orgA, event.id);

    const answer = await importRunOf(orgA, lot!.id);
    // NOT NULL. Null is "there is no such lot", and the screen renders those
    // two states completely differently — one is a 404 and the other is a
    // sentence explaining that the note of where it came from is missing.
    expect(answer).not.toBeNull();
    expect(answer?.run).toBeNull();
    // The row survives without a run: `PreparedLot` carries it whether or not
    // an import recorded itself, and half an answer beats none.
    expect(answer?.sourceRow).toBe(3);
  });

  it("returns null for a lot that is not this org's, rather than the other org's answer", async () => {
    const theirs = await createEvent(orgB, { name: "Someone Else's Sale" });
    const runId = await makeRun(orgB, theirs.id);
    await insertLots(orgB, theirs.id, [{ ref: "T1", fields: {}, sourceRow: 1 }], {
      importRunId: runId,
    });
    const [lot] = await listLots(orgB, theirs.id);

    // An id is not an authorisation — the rule every reader in this layer
    // keeps, asserted here because a provenance record names a client's file.
    expect(await importRunOf(orgA, lot!.id)).toBeNull();
    expect(await importRunOf(orgB, lot!.id)).not.toBeNull();
  });

  it("keeps the lots when the record of the import is deleted", async () => {
    const event = await createEvent(orgA, { name: "Forgotten Import" });
    const runId = await makeRun(orgA, event.id);
    await insertLots(orgA, event.id, [{ ref: "F1", fields: {}, sourceRow: 5 }], {
      importRunId: runId,
    });
    const [lot] = await listLots(orgA, event.id);

    // `on delete set null`, and this is why: deleting the record of an import
    // must never delete the lots it made. A `cascade` here would have turned
    // a housekeeping delete into a silent loss of a sale.
    await db.delete(importRuns).where(eq(importRuns.id, runId));

    const answer = await importRunOf(orgA, lot!.id);
    expect(answer).not.toBeNull();
    expect(answer?.run).toBeNull();
    expect(answer?.sourceRow).toBe(5);
    expect(await listLots(orgA, event.id)).toHaveLength(1);
  });

  it("writes no run and no row for a lot made without either", async () => {
    // The state every lot imported before `drizzle/0006` is in. Asserted so
    // that a later change making the columns required fails here rather than
    // on a customer's database.
    const event = await createEvent(orgA, { name: "Before The Migration" });
    await db.insert(lots).values({ orgId: orgA, eventId: event.id, ref: "B1" });
    const [lot] = await listLots(orgA, event.id);

    const answer = await importRunOf(orgA, lot!.id);
    expect(answer?.sourceRow).toBeNull();
    expect(answer?.run).toBeNull();
  });
});
