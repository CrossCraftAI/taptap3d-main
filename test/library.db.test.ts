// The library's paging and the house's field set, against a real Postgres.
//
// Both of these are SQL now and neither can be checked by reading it. A page
// is only meaningful if the order is total, a faceted count is only useful if
// it counts the rows the listing will show, and `jsonb_object_keys` over an
// open column is the kind of query that works on the developer's data and
// raises on somebody else's.
//
// test/photographs.test.ts holds the arithmetic around these; this holds the
// queries under it.

import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getDb, getPool, orgs } from "@/db";
import { attachAssets, countLibrary, listAssets, recordAsset } from "@/lib/data/assets";
import { createEvent } from "@/lib/data/events";
import { insertLots, listLots } from "@/lib/data/lots";
import { listFieldKeys } from "@/lib/data/org";

const db = getDb();
let orgA: string;
let orgB: string;
let lotA: string;

/**
 * A 64-character lowercase hex hash, the shape the store uses.
 *
 * FROM A NUMBER, NOT FROM THE NAME. The first version folded a seed string
 * into hex and padded it, and `lib2` and `lib20` collapsed to the same
 * digits — so the store deduplicated two photographs the fixture believed it
 * had created and every count in this file was two short. The store was
 * right; the fixture was lying. test/e2e/photographs.spec.ts has its own note
 * about the same class of mistake.
 */
const hash = (n: number): string => n.toString(16).padStart(64, "0");

async function makeOrg(label: string): Promise<string> {
  const [row] = await db
    .insert(orgs)
    .values({ name: label, slug: `${label}-${randomUUID().slice(0, 8)}` })
    .returning({ id: orgs.id });
  return row!.id;
}

async function store(orgId: string, seed: number, name: string): Promise<string> {
  const { id } = await recordAsset(orgId, {
    contentHash: hash(seed),
    mimeType: "image/jpeg",
    byteSize: 1234,
    originalName: name,
    geometry: null,
  });
  return id;
}

/** How many photographs this suite puts in, and it is more than one page. */
const HELD = 25;

beforeAll(async () => {
  orgA = await makeOrg("library-a");
  orgB = await makeOrg("library-b");

  const event = await createEvent(orgA, { name: "Library Sale" });
  await insertLots(orgA, event.id, [
    {
      ref: "L01",
      // A core field, one of the house's own, and a carried key that must
      // never be offered a level because it never prints.
      fields: { title: "青花梅瓶", 保留價: "750,000 HKD", _source: "row 1" },
      sourceRow: 1,
    },
    { ref: "L02", fields: { title: "山水四屏", 保留價: "" }, sourceRow: 2 },
    { ref: "L03", fields: { title: "墨荷", 委託人: "高氏家族" }, sourceRow: 3 },
  ]);
  lotA = (await listLots(orgA, event.id))[0]!.id;

  // Written in one pass, so most of them share a `created_at` to the
  // microsecond — which is the condition the tie-break in `listAssets` exists
  // for and the condition a page turn is otherwise unstable under.
  for (let i = 0; i < HELD; i++) {
    await store(orgA, i + 1, `IMG_${1000 + i}.jpg`);
  }
  // One name that a raw ILIKE would match by accident, because `_` is a
  // single-character wildcard there.
  await store(orgA, 900, "IMGx4471.jpg");
  await store(orgA, 901, "IMG_4471.jpg");
  // And one on a lot, so the three facets are genuinely three.
  const filed = await store(orgA, 902, "ON_A_LOT.jpg");
  await attachAssets(orgA, lotA, [filed]);

  // Another house holding an identically named file, so every assertion below
  // is also an assertion that one org's query does not reach another's. The
  // same bytes, too: the store keys on (org, hash), so this proves the row is
  // never shared even when the blob is.
  await store(orgB, 1, "IMG_1000.jpg");
});

afterAll(async () => {
  await db.delete(orgs).where(eq(orgs.id, orgA));
  await db.delete(orgs).where(eq(orgs.id, orgB));
  await getPool().end();
});

const TOTAL = HELD + 3;

describe("the library's three counts", () => {
  it("counts this house's photographs and nobody else's", async () => {
    const counts = await countLibrary(orgA);
    expect(counts.all).toBe(TOTAL);
    expect(counts.assigned).toBe(1);
    expect(counts.unassigned).toBe(TOTAL - 1);
    // The three are one query, so they cannot disagree about the whole.
    expect(counts.unassigned + counts.assigned).toBe(counts.all);
  });

  it("counts what the search left, not what the house holds", async () => {
    // A tab reading "12" that lands on an empty grid is the defect a faceted
    // count exists to prevent.
    const counts = await countLibrary(orgA, "ON_A_LOT");
    expect(counts.all).toBe(1);
    expect(counts.assigned).toBe(1);
    expect(counts.unassigned).toBe(0);
  });

  it("treats the underscore in a filename as a character, not a wildcard", async () => {
    // `IMG_4471.jpg` and `IMGx4471.jpg` are both in the store. A raw ILIKE
    // finds both, which is wrong rarely enough that nobody would notice and
    // wrong every time somebody searches a camera's filename.
    expect((await countLibrary(orgA, "IMG_4471")).all).toBe(1);
    const found = await listAssets(orgA, { q: "IMG_4471" });
    expect(found.map((row) => row.originalName)).toEqual(["IMG_4471.jpg"]);
  });

  it("finds a substring anywhere in the name, ignoring case", async () => {
    expect((await countLibrary(orgA, "on_a_lot")).all).toBe(1);
    expect((await countLibrary(orgA, "4471")).all).toBe(2);
    expect((await countLibrary(orgA, "nothing is called this")).all).toBe(0);
  });
});

describe("a page of the library", () => {
  it("is a window, and the windows tile the whole set exactly once", async () => {
    // THE FAILURE THIS EXISTS FOR: two rows the database may return either
    // way round means a photograph appears on page two AND page three, or on
    // neither — and the person filing them never finds out which. Everything
    // here was written in one pass, so the `created_at` ties are real.
    const size = 10;
    const seen: string[] = [];
    for (let offset = 0; offset < TOTAL; offset += size) {
      const page = await listAssets(orgA, { limit: size, offset });
      seen.push(...page.map((row) => row.id));
    }
    expect(seen).toHaveLength(TOTAL);
    expect(new Set(seen).size).toBe(TOTAL);

    // And the same windows, asked for again, give the same answer in the same
    // order — which is the half a single pass cannot show.
    const again: string[] = [];
    for (let offset = 0; offset < TOTAL; offset += size) {
      const page = await listAssets(orgA, { limit: size, offset });
      again.push(...page.map((row) => row.id));
    }
    expect(again).toEqual(seen);
  });

  it("narrows by filter and search together", async () => {
    const page = await listAssets(orgA, { filter: "assigned", q: "ON_A" });
    expect(page.map((row) => row.originalName)).toEqual(["ON_A_LOT.jpg"]);
    expect(await listAssets(orgA, { filter: "unassigned", q: "ON_A" })).toEqual([]);
  });

  it("asks for nothing past the end rather than erroring", async () => {
    expect(await listAssets(orgA, { limit: 10, offset: TOTAL + 100 })).toEqual([]);
  });
});

describe("the house's own field set", () => {
  it("is read from the records, because it is nowhere else", async () => {
    // 保留價 is in no source file. `CORE_FIELDS` is the part this system
    // named; this is the part the customer did.
    const keys = await listFieldKeys(orgA);
    const byKey = new Map(keys.map((k) => [k.key, k.lots]));
    expect(byKey.get("title")).toBe(3);
    expect(byKey.get("保留價")).toBe(2);
    expect(byKey.get("委託人")).toBe(1);
  });

  it("counts a key that is present and empty", async () => {
    // L02 holds 保留價 as an empty string. The question the screen asks is
    // "does this house have such a column", and it does — a lot that has it
    // blank today has it filled tomorrow, and the level must already be set.
    expect((await listFieldKeys(orgA)).find((k) => k.key === "保留價")?.lots).toBe(2);
  });

  it("puts the most-used first, and is stable between reads", async () => {
    const first = await listFieldKeys(orgA);
    const counts = first.map((k) => k.lots);
    expect([...counts].sort((a, b) => b - a)).toEqual(counts);
    // A settings screen whose rows move between two visits is one nobody
    // trusts, so the tie-break is by name rather than left to the planner.
    expect(await listFieldKeys(orgA)).toEqual(first);
  });

  it("does not reach another house's columns", async () => {
    expect((await listFieldKeys(orgB)).map((k) => k.key)).toEqual([]);
  });

  it("returns the carried keys, and the screen is what drops them", async () => {
    // `_source` is in the records, so this query reports it — the filtering
    // is a product decision and it lives in src/lib/settings.ts, where it can
    // be argued and tested without a database. Asserted here so the two ends
    // of that split stay honest about which one is doing the work.
    expect((await listFieldKeys(orgA)).map((k) => k.key)).toContain("_source");
  });
});
