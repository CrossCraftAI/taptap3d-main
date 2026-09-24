// The field policy against a real Postgres, and the whole path end to end.
//
// The pure tests next door prove the ladder and the drop. What they cannot
// prove is the part that has actually gone wrong in this codebase before: that
// a nullable jsonb column written by one function and read by another comes
// back as the same thing, that a tenant's answer is a tenant's answer, and that
// an org row written before the column existed still works. The predecessor's
// carried decisions were invisible to the engine for exactly one reason — a
// column read one way and written another — and that is a database fact, not a
// TypeScript one.
//
// Needs a database and says so by failing — see test/schema.db.test.ts on why a
// self-skipping suite is worse than a red one.
//
// Run `docker compose up -d && npm run db:migrate` first.

import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getDb, getPool, orgs } from "@/db";
import { fieldPolicyOf, setFieldPolicy } from "@/lib/data/org";
import { DEFAULT_PARAMS, derive, type EngineLot } from "@/lib/engine/derive";
import { BUILT_IN_TEMPLATES, CATALOGUE } from "@/lib/engine/templates";
import { EMPTY_POLICY, levelOf } from "@/lib/engine/visibility";
import { renderCatalogue } from "@/lib/render/html";

const db = getDb();

let orgA: string;
let orgB: string;
/**
 * A third house that NOTHING IN THIS FILE EVER WRITES TO.
 *
 * The "unchanged by default" claims have to be made against a row whose column
 * has never been touched, and making them against `orgA` or `orgB` would make
 * them depend on the order the tests above happened to run in — which is
 * exactly how a default quietly stops being tested.
 */
let orgUntouched: string;

async function makeOrg(label: string): Promise<string> {
  const [row] = await db
    .insert(orgs)
    .values({ name: label, slug: `${label}-${randomUUID().slice(0, 8)}` })
    .returning({ id: orgs.id });
  return row!.id;
}

beforeAll(async () => {
  orgA = await makeOrg("visibility-a");
  orgB = await makeOrg("visibility-b");
  orgUntouched = await makeOrg("visibility-untouched");
});

afterAll(async () => {
  await db.delete(orgs).where(eq(orgs.id, orgA));
  await db.delete(orgs).where(eq(orgs.id, orgB));
  await db.delete(orgs).where(eq(orgs.id, orgUntouched));
  await getPool().end();
});

const RESERVE = "底價";
const CONSIGNOR = "委託人";

describe("orgs.field_policy", () => {
  it("is null on a freshly created org, which is what every existing row is", async () => {
    // THE DEFAULT, AT THE COLUMN. `ADD COLUMN … jsonb` with no default and no
    // NOT NULL is why this migration rewrote nothing, and why an org carried
    // across from the predecessor prints exactly what it printed yesterday.
    const [row] = await db
      .select({ policy: orgs.fieldPolicy })
      .from(orgs)
      .where(eq(orgs.id, orgUntouched));
    expect(row!.policy).toBeNull();
  });

  it("reads a null column as no policy at all, without throwing", async () => {
    // A reader that could refuse a stored value is a catalogue nobody can
    // print — the rule `overrideFromValue` follows, held here for the org row.
    expect(await fieldPolicyOf(orgUntouched)).toBe(EMPTY_POLICY);
  });

  it("reads an org id that does not exist as no policy, not as an error", async () => {
    // `currentOrgId` is a stopgap and will be replaced by a session lookup; a
    // reader that threw on a stale id would take a whole screen down with it,
    // and "no policy" is the only honest answer about a house that is not
    // there.
    expect(await fieldPolicyOf(randomUUID())).toBe(EMPTY_POLICY);
  });

  it("round-trips what was written, through one normaliser in both directions", async () => {
    // WHAT IS STORED IS WHAT IS READ. `setFieldPolicy` normalises through
    // `policyFor`, which is the same function `fieldPolicyOf` reads with, so
    // there is no second predicate to drift from the first — the property the
    // override writer buys the same way.
    await setFieldPolicy(orgA, { [RESERVE]: "house", [CONSIGNOR]: "internal" });
    const policy = await fieldPolicyOf(orgA);
    expect(levelOf(policy, RESERVE)).toBe("house");
    expect(levelOf(policy, CONSIGNOR)).toBe("internal");
    expect(levelOf(policy, "title")).toBe("public");
  });

  it("stores the normalised form, not the form it was handed", async () => {
    // Read back through the COLUMN rather than through the reader, because a
    // writer that stored nonsense and a reader that repaired it on the way
    // out would pass every test above and leave the database holding a value
    // the next consumer — a report, a migration, a person with psql — reads
    // differently.
    await setFieldPolicy(orgA, { [RESERVE]: "hosue", ok: "internal", ["k".repeat(81)]: "house" });
    const [row] = await db
      .select({ policy: orgs.fieldPolicy })
      .from(orgs)
      .where(eq(orgs.id, orgA));
    expect(row!.policy).toEqual({ [RESERVE]: "house", ok: "internal" });
  });

  it("is written whole, so un-marking a field is expressible", async () => {
    // A POLICY REPLACES AND AN OVERRIDE MERGES, and the asymmetry is argued in
    // src/lib/data/org.ts. Here is the consequence that matters: with a merge,
    // an absent key would mean "leave it alone" and there would be no way at
    // all to say "this field is public again".
    await setFieldPolicy(orgA, { [RESERVE]: "house", [CONSIGNOR]: "internal" });
    await setFieldPolicy(orgA, { [RESERVE]: "house" });
    const policy = await fieldPolicyOf(orgA);
    expect(levelOf(policy, RESERVE)).toBe("house");
    expect(levelOf(policy, CONSIGNOR)).toBe("public");
  });

  it("is one tenant's answer and never another's", async () => {
    // ARCHITECTURE.md principle 7. A policy is the one row in this schema
    // whose leakage would be silent in the worst direction: house B inheriting
    // house A's marks prints nothing wrong, and house B NOT inheriting its own
    // prints house B's reserve.
    await setFieldPolicy(orgA, { [RESERVE]: "house" });
    expect(levelOf(await fieldPolicyOf(orgB), RESERVE)).toBe("public");
    await setFieldPolicy(orgB, { [CONSIGNOR]: "house" });
    expect(levelOf(await fieldPolicyOf(orgA), CONSIGNOR)).toBe("public");
    expect(levelOf(await fieldPolicyOf(orgA), RESERVE)).toBe("house");
  });

  it("survives whatever a hand-written statement puts in the column", async () => {
    // jsonb is jsonb: a restored backup, a psql session, a later version of
    // this file. The reader is total over all of it and the engine still
    // derives.
    for (const raw of [{}, { a: 1 }, { a: null }, [1, 2], "nonsense", 42] as unknown[]) {
      await db
        .update(orgs)
        .set({ fieldPolicy: raw as Record<string, unknown> })
        .where(eq(orgs.id, orgA));
      const policy = await fieldPolicyOf(orgA);
      expect(() => derive([], DEFAULT_PARAMS, [], [], BUILT_IN_TEMPLATES, policy)).not.toThrow();
    }
  });
});

// ── The whole path ──────────────────────────────────────────────────────────

describe("a field marked house does not appear in the bytes a public output ships", () => {
  const LOTS: EngineLot[] = [
    {
      id: "a",
      ref: "P01",
      fields: {
        title: "青花纏枝蓮紋梅瓶",
        price: "800,000 – 1,200,000 HKD",
        [RESERVE]: "750,000 HKD",
        [CONSIGNOR]: "高氏家族",
      },
      images: [],
    },
  ];

  const renderFor = async (
    orgId: string,
    audience: "public" | "internal" | "house",
  ): Promise<string> =>
    renderCatalogue(
      derive(
        LOTS,
        { ...DEFAULT_PARAMS, template: CATALOGUE.id, audience },
        [],
        [],
        BUILT_IN_TEMPLATES,
        await fieldPolicyOf(orgId),
      ),
    );

  it("from the column, through the engine, into the document", async () => {
    // THE STRING, not the document. A search of the rendered bytes is the only
    // assertion that cannot be satisfied by a value that survived in a shape
    // nobody happened to look at — and it is the same unit the print route
    // hands to the browser it prints with.
    await setFieldPolicy(orgA, { [RESERVE]: "house", [CONSIGNOR]: "internal" });

    const publicly = await renderFor(orgA, "public");
    expect(publicly).not.toContain("750,000");
    expect(publicly).not.toContain("高氏家族");
    // BOTH ENDS: the values are in the record and would otherwise print.
    expect(publicly).toContain("800,000");

    const internally = await renderFor(orgA, "internal");
    expect(internally).toContain("高氏家族");
    expect(internally).not.toContain("750,000");

    const inHouse = await renderFor(orgA, "house");
    expect(inHouse).toContain("750,000");
    expect(inHouse).toContain("高氏家族");
  });

  it("and the house that marked nothing still prints everything", async () => {
    // The org nothing in this file has written to — the state of every org in
    // every database today, and the reason the four goldens did not move.
    const theirs = await renderFor(orgUntouched, "public");
    expect(theirs).toContain("750,000");
    expect(theirs).toContain("高氏家族");
  });
});
