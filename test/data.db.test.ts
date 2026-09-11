// The data layer against a real Postgres.
//
// Needs a database and says so by failing — see test/schema.db.test.ts on why
// there is no skip path anywhere in this suite.

import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { assets, getDb, getPool, lotAssets, orgs } from "@/db";
import { createEvent, getEvent, listEvents } from "@/lib/data/events";
import { currentOrgId, NoOrgError } from "@/lib/data/org";
import { insertLots, listLots } from "@/lib/data/lots";
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
