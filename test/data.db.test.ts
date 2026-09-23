// The data layer against a real Postgres.
//
// Needs a database and says so by failing — see test/schema.db.test.ts on why
// there is no skip path anywhere in this suite.

import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { assets, getDb, getPool, lotAssets, orgs } from "@/db";
import { ensureCatalogue, markExported } from "@/lib/data/catalogues";
import {
  createEvent,
  getEvent,
  getEventSummary,
  listEventChoices,
  listEvents,
  setStageOverride,
} from "@/lib/data/events";
import { currentOrgId, NoOrgError } from "@/lib/data/org";
import { insertLots, listLots, lotNeighbours } from "@/lib/data/lots";
import { applyMapping } from "@/lib/import/apply";
import { inferMapping } from "@/lib/import/infer";
import { parsePastedText } from "@/lib/import/parse";

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

beforeAll(async () => {
  orgA = await makeOrg("data-a");
  orgB = await makeOrg("data-b");
});

afterAll(async () => {
  await db.delete(orgs).where(eq(orgs.id, orgA));
  await db.delete(orgs).where(eq(orgs.id, orgB));
  await getPool().end();
});

describe("events", () => {
  it("are listed only for their own org", async () => {
    await createEvent(orgA, { name: "Autumn Sale" });
    await createEvent(orgB, { name: "Someone Else's Sale" });

    const mine = await listEvents(orgA);
    expect(mine.map((e) => e.name)).toEqual(["Autumn Sale"]);
  });

  it("cannot be fetched across orgs by guessing an id", async () => {
    const theirs = await createEvent(orgB, { name: "Private Sale" });
    // The predecessor's entire API addressed by id alone with no ownership
    // check, so anyone with a URL could read — and delete — anything.
    expect(await getEvent(orgA, theirs.id)).toBeNull();
    expect(await getEvent(orgB, theirs.id)).not.toBeNull();
  });

  it("counts lots and photographed lots, and the counts are real", async () => {
    // THE TEST THIS FUNCTION EXISTS FOR. The predecessor shipped a list page
    // whose counts were all zero: a drizzle `sql` template inside `.select()`
    // returned 0 where the same SQL returned 43, and nothing failed — the page
    // simply lied. So the numbers are asserted against known data.
    const event = await createEvent(orgA, { name: "Counted Sale" });
    await insertLots(orgA, event.id, [
      { ref: "P01", fields: { title: "甲" }, sourceRow: 2 },
      { ref: "P02", fields: { title: "乙" }, sourceRow: 3 },
      { ref: "P03", fields: { title: "丙" }, sourceRow: 4 },
    ]);

    // Photograph exactly one of them.
    const stored = await listLots(orgA, event.id);
    const [asset] = await db
      .insert(assets)
      .values({
        orgId: orgA,
        contentHash: `sha256:${randomUUID()}`,
        mimeType: "image/jpeg",
        byteSize: 2048,
      })
      .returning({ id: assets.id });
    await db.insert(lotAssets).values({
      orgId: orgA,
      lotId: stored[0]!.id,
      assetId: asset!.id,
      isPrimary: true,
    });

    const listed = await listEvents(orgA);
    const counted = listed.find((e) => e.id === event.id);
    expect(counted?.lotCount).toBe(3);
    expect(counted?.photographedCount).toBe(1);
    // And a number, not a string — node-postgres returns bigint counts as text,
    // which is how a count becomes "3" and a sum becomes "33".
    expect(typeof counted?.lotCount).toBe("number");
  });

  it("counts catalogues and exports — the facts the stage is read from", async () => {
    // Same reason as the lot counts: a correlated subquery that quietly returns
    // zero would read every sale as New forever, and nothing would error.
    const event = await createEvent(orgA, { name: "Staged Sale" });
    const summaryOf = async () =>
      (await listEvents(orgA)).find((e) => e.id === event.id)!;

    expect(await summaryOf()).toMatchObject({
      catalogueCount: 0,
      exportedCount: 0,
      stageOverride: null,
    });

    // Opening the catalogue is the fact; taking the PDF is the next one.
    const catalogue = await ensureCatalogue(orgA, event.id);
    expect(await summaryOf()).toMatchObject({ catalogueCount: 1, exportedCount: 0 });

    await markExported(orgA, catalogue.id);
    const exported = await summaryOf();
    expect(exported).toMatchObject({ catalogueCount: 1, exportedCount: 1 });
    expect(typeof exported.exportedCount).toBe("number");

    // ONE SHAPE. The event page reads the same row through getEventSummary,
    // and the ledger and the event page must not disagree about one sale.
    expect(await getEventSummary(orgA, event.id)).toEqual(exported);
  });

  it("records an export only for the org that owns the catalogue", async () => {
    const event = await createEvent(orgA, { name: "Guarded Sale" });
    const catalogue = await ensureCatalogue(orgA, event.id);
    await markExported(orgB, catalogue.id);
    const summary = await getEventSummary(orgA, event.id);
    expect(summary?.exportedCount).toBe(0);
  });

  it("lets a person set the stage, remembers it, and lets them take it back", async () => {
    const event = await createEvent(orgA, { name: "Pinned Sale" });

    // Another org cannot set it by guessing the id — both conditions, always.
    expect(await setStageOverride(orgB, event.id, "catalogued")).toBe(false);
    expect((await getEventSummary(orgA, event.id))?.stageOverride).toBeNull();

    expect(await setStageOverride(orgA, event.id, "catalogued")).toBe(true);
    expect((await getEventSummary(orgA, event.id))?.stageOverride).toBe("catalogued");
    // The ledger carries it too, so the row and the page say the same thing.
    expect((await listEvents(orgA)).find((e) => e.id === event.id)?.stageOverride).toBe(
      "catalogued",
    );

    // Reversible (principle 9): null is "as the data says", and it is a real
    // write, not a no-op that leaves the old answer standing.
    expect(await setStageOverride(orgA, event.id, null)).toBe(true);
    expect((await getEventSummary(orgA, event.id))?.stageOverride).toBeNull();

    // And the summary of another org's event is not this org's to read.
    expect(await getEventSummary(orgB, event.id)).toBeNull();
  });

  it("offers the switcher the most recently touched first", async () => {
    // THE ORDER IS LOAD-BEARING NOW. The top bar paints the head of this list
    // and nothing else (src/lib/nav.ts `switcherRows`), so "most recently
    // touched" has to be true of the query rather than of the intention —
    // and the failure mode is silent: a wrong ORDER BY still returns every
    // row, it just offers the wrong ten.
    const org = await makeOrg("choices");
    try {
      const first = await createEvent(org, { name: "Choice One" });
      const second = await createEvent(org, { name: "Choice Two" });
      const third = await createEvent(org, { name: "Choice Three" });

      // Untouched since creation, so newest-first — which is the order this
      // had before `updated_at` came into it, and the tiebreak keeps it.
      expect((await listEventChoices(org)).map((e) => e.name)).toEqual([
        "Choice Three",
        "Choice Two",
        "Choice One",
      ]);

      // Touching the oldest one moves it to the head. Setting a stage is the
      // one thing that writes `updated_at` today; whatever else learns to,
      // the menu follows it without another change here.
      expect(await setStageOverride(org, first.id, "catalogued")).toBe(true);
      expect((await listEventChoices(org)).map((e) => e.name)).toEqual([
        "Choice One",
        "Choice Three",
        "Choice Two",
      ]);

      // And it carries the lot count the palette and the rail both read, as a
      // number rather than the string node-postgres hands back for a count.
      await insertLots(org, second.id, [
        { ref: "1", fields: { title: "A" }, sourceRow: 1 },
      ]);
      const choice = (await listEventChoices(org)).find((e) => e.id === second.id);
      expect(choice?.lotCount).toBe(1);
      expect(choice?.lotCount).not.toBe("1");
      expect((await listEventChoices(org)).find((e) => e.id === third.id)?.lotCount).toBe(0);
    } finally {
      await db.delete(orgs).where(eq(orgs.id, org));
    }
  });
});

describe("lots", () => {
  it("keep the order the file gave them", async () => {
    const event = await createEvent(orgA, { name: "Ordered Sale" });
    await insertLots(orgA, event.id, [
      { ref: "P10", fields: {}, sourceRow: 2 },
      { ref: "P02", fields: {}, sourceRow: 3 },
      { ref: "P07", fields: {}, sourceRow: 4 },
    ]);
    const stored = await listLots(orgA, event.id);
    // File order, NOT sorted by ref. The house sequenced the sheet deliberately,
    // and "P10" cannot be sorted numerically anyway.
    expect(stored.map((l) => l.ref)).toEqual(["P10", "P02", "P07"]);
  });

  it("are invisible to another org", async () => {
    const event = await createEvent(orgA, { name: "Scoped Sale" });
    await insertLots(orgA, event.id, [{ ref: "P01", fields: {}, sourceRow: 2 }]);
    expect(await listLots(orgB, event.id)).toHaveLength(0);
  });
});

describe("stepping between the lots of one sale", () => {
  it("says where a lot sits, and stops at both ends instead of wrapping", async () => {
    const event = await createEvent(orgA, { name: "Stepped Sale" });
    await insertLots(orgA, event.id, [
      { ref: "S01", fields: {}, sourceRow: 2 },
      { ref: "S02", fields: {}, sourceRow: 3 },
      { ref: "S03", fields: {}, sourceRow: 4 },
    ]);
    const stored = await listLots(orgA, event.id);

    expect(await lotNeighbours(orgA, event.id, stored[1]!.id)).toEqual({
      index: 2,
      total: 3,
      prev: { id: stored[0]!.id, ref: "S01" },
      next: { id: stored[2]!.id, ref: "S03" },
    });

    // THE ENDS ARE ENDS. Wrapping is the surprise that makes somebody lose
    // their place in a long sale, so `prev` and `next` are null there and the
    // control has nothing to render but a disabled button.
    expect(await lotNeighbours(orgA, event.id, stored[0]!.id)).toMatchObject({
      index: 1,
      prev: null,
      next: { ref: "S02" },
    });
    expect(await lotNeighbours(orgA, event.id, stored[2]!.id)).toMatchObject({
      index: 3,
      prev: { ref: "S02" },
      next: null,
    });

    // Numbers, not the strings node-postgres hands back for a bigint count.
    const one = await lotNeighbours(orgA, event.id, stored[0]!.id);
    expect(typeof one?.index).toBe("number");
    expect(typeof one?.total).toBe("number");
  });

  it("walks exactly the order the sale's own table shows", async () => {
    // TWO IMPORTS INTO ONE EVENT, which is the case that breaks a naive
    // ordering: `position` is numbered from zero per import, so every row of
    // the second import ties with a row of the first and the tiebreakers
    // decide. Whatever order they decide, this must be the SAME one
    // `listLots` returns — a Next button that disagrees with the row below it
    // in the table is worse than no Next button at all.
    const event = await createEvent(orgA, { name: "Twice-Imported Sale" });
    await insertLots(orgA, event.id, [
      { ref: "A1", fields: {}, sourceRow: 2 },
      { ref: "A2", fields: {}, sourceRow: 3 },
    ]);
    await insertLots(orgA, event.id, [
      { ref: "B1", fields: {}, sourceRow: 2 },
      { ref: "B2", fields: {}, sourceRow: 3 },
    ]);
    const table = await listLots(orgA, event.id);
    expect(table).toHaveLength(4);

    const forwards: string[] = [];
    let at: string | null = table[0]!.id;
    while (at) {
      const step = await lotNeighbours(orgA, event.id, at);
      forwards.push(at);
      expect(step?.index).toBe(forwards.length);
      expect(step?.total).toBe(4);
      at = step?.next?.id ?? null;
    }
    expect(forwards).toEqual(table.map((l) => l.id));

    // And back up the same sequence: prev is not a second, differently-ordered
    // query that happens to agree most of the time.
    const backwards: string[] = [];
    let from: string | null = table[3]!.id;
    while (from) {
      backwards.push(from);
      from = (await lotNeighbours(orgA, event.id, from))?.prev?.id ?? null;
    }
    expect(backwards).toEqual([...table].reverse().map((l) => l.id));
  });

  it("is not another org's to walk, and not another sale's", async () => {
    const event = await createEvent(orgA, { name: "Fenced Sale" });
    await insertLots(orgA, event.id, [{ ref: "F01", fields: {}, sourceRow: 2 }]);
    const [lot] = await listLots(orgA, event.id);

    // Both conditions, always — an id alone is not an authorisation, and a
    // stepper that answered here would leak the size of another house's sale.
    expect(await lotNeighbours(orgB, event.id, lot!.id)).toBeNull();

    // Right org, wrong sale. The lot is theirs and still is not in this
    // event's sequence, so there is no position to report.
    const other = await createEvent(orgA, { name: "Neighbouring Sale" });
    expect(await lotNeighbours(orgA, other.id, lot!.id)).toBeNull();
  });
});

describe("the whole journey, paste to lots", () => {
  it("takes pasted text through matching and into the database", async () => {
    // Demo steps 3 → 4 → 5, end to end, with nothing stubbed: this is the path
    // that runs in front of a client.
    const pasted = [
      "編號\t品名\t作者\t估價",
      "P01\t秋山圖\t張大千\t800,000–1,200,000 HKD",
      "P02\t墨荷\t齊白石\t400,000–600,000 HKD",
    ].join("\n");

    const parsed = parsePastedText(pasted);
    expect(parsed.kind).toBe("table");
    if (parsed.kind !== "table") return;

    const suggestions = inferMapping(parsed.headers, parsed.rows);
    expect(suggestions.map((s) => s.suggested)).toEqual([
      "ref",
      "title",
      "maker",
      "price",
    ]);

    // A person clears the mapping — here, by accepting it unchanged.
    const mapping = suggestions.map((s) =>
      s.suggested
        ? ({ kind: "core", field: s.suggested } as const)
        : ({ kind: "skip" } as const),
    );
    const prepared = applyMapping(parsed, mapping);
    expect(prepared.warnings).toEqual([]);

    const event = await createEvent(orgA, { name: "Pasted Sale" });
    const written = await insertLots(orgA, event.id, prepared.lots);
    expect(written).toBe(2);

    const stored = await listLots(orgA, event.id);
    expect(stored.map((l) => l.ref)).toEqual(["P01", "P02"]);
    expect(stored[0]!.fields).toEqual({
      ref: "P01",
      title: "秋山圖",
      maker: "張大千",
      price: "800,000–1,200,000 HKD",
    });
  });
});

describe("which org is acting, before there is a sign-in", () => {
  const original = process.env.TAPTAP3D_ORG_SLUG;
  afterAll(() => {
    if (original === undefined) delete process.env.TAPTAP3D_ORG_SLUG;
    else process.env.TAPTAP3D_ORG_SLUG = original;
  });

  it("REFUSES when more than one org exists", async () => {
    // The property that matters. A silent "pick the first" would work perfectly
    // on a single-tenant development machine and start mixing two customers'
    // data the first time it did not. This suite creates two orgs, so the
    // ambiguous case is the one under test.
    delete process.env.TAPTAP3D_ORG_SLUG;
    await expect(currentOrgId()).rejects.toBeInstanceOf(NoOrgError);
    await expect(currentOrgId()).rejects.toThrow(/more than one/i);
  });

  it("resolves the one named by TAPTAP3D_ORG_SLUG", async () => {
    const [row] = await db
      .select({ slug: orgs.slug })
      .from(orgs)
      .where(eq(orgs.id, orgA))
      .limit(1);
    process.env.TAPTAP3D_ORG_SLUG = row!.slug;
    expect(await currentOrgId()).toBe(orgA);
  });

  it("says what to do when the named org does not exist", async () => {
    process.env.TAPTAP3D_ORG_SLUG = "no-such-house";
    // The message names the variable and its value, because the reader is
    // looking at a page that will not load and needs to know which of the two
    // is wrong.
    await expect(currentOrgId()).rejects.toThrow(/no-such-house/);
  });
});
