// drizzle/0003_carried_decisions.sql, run against a real Postgres.
//
// The migration's whole claim is about rows nobody in this repository wrote:
// the predecessor's hidden-field decisions, carried over by
// docker/migrate-from-tap3d.mjs with `decided_by = null` and therefore read by
// listOverrides as unconfirmed machine proposals. So the fixture here is not an
// approximation of those rows — it is what that script's INSERT produces,
// literally, including the proposals it carries beside them under a composite
// field key.
//
// ── WHY THIS FILE MAKES ITS OWN DATABASE ────────────────────────────────────
//
// The backfill is one table-wide UPDATE with no org in its predicate, because
// the rows it repairs belong to every house that was migrated. The rest of the
// suite shares one database and runs in parallel, and test/corrections.db.test.ts
// deliberately parks a row with `decided_by = null` and `{hidden: true}` —
// indistinguishable from a carried decision, because that is precisely what it
// is imitating. Running this migration beside it would confirm that row and
// fail that test perhaps one run in fifty, which is the worst kind of failure
// this suite can grow: real, rare, and blamed on the wrong file.
//
// A scratch database costs about a second and removes the question. The real
// migrator applies every migration into it in order, which is also the only
// place anything proves that 0003 parses and runs in sequence at all.
//
// Rejected: asserting the post-backfill SHAPE on hand-written rows, without
// running the file. That tests listOverrides, which is tested next door, and
// never touches the statement that is the actual deliverable.
// Rejected: a copy of the UPDATE narrowed to this test's org. A paraphrase of a
// migration proves things about the paraphrase.
//
// The file is run a SECOND time here, and that is not a contrivance: the
// migrator applies it once during setup, on an empty database, before the rows
// it exists for are there. Re-running it is the idempotency the migration
// claims, exercised on the data it was written for.
//
// Needs a database and says so by failing — see test/schema.db.test.ts.

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { and, eq, isNull, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  catalogues,
  events,
  getDb,
  getPool,
  lots,
  memberships,
  orgs,
  overrides,
  users,
} from "@/db";
import { currentActorId, gateEmail } from "@/lib/data/actor";
import { listOverrides, type OverrideRow } from "@/lib/data/overrides";

const MIGRATIONS = fileURLToPath(new URL("../drizzle", import.meta.url));
const BACKFILL = join(MIGRATIONS, "0003_carried_decisions.sql");

const HOME = process.env.DATABASE_URL ?? "";
if (!HOME) throw new Error("DATABASE_URL is not set; this file needs a database.");
const SCRATCH = `taptap3d_carried_${randomUUID().replace(/-/g, "").slice(0, 12)}`;

function urlFor(database: string): string {
  const url = new URL(HOME);
  url.pathname = `/${database}`;
  return url.toString();
}

let db: ReturnType<typeof getDb>;

/** The shipped file, statement by statement, exactly as the migrator splits it. */
async function runBackfill(): Promise<void> {
  const file = readFileSync(BACKFILL, "utf8");
  for (const statement of file.split("--> statement-breakpoint")) {
    await db.execute(sql.raw(statement));
  }
}

let orgCarried: string;
let slugCarried: string;
let nameCarried: string;
let orgProposalOnly: string;
let slugProposalOnly: string;
let catalogueCarried: string;
let before: OverrideRow[];
let after: OverrideRow[];
let touchedBefore: Map<string, number>;

/** One house, its sale, and the four rows the predecessor's migration left. */
async function seedCarriedHouse(): Promise<void> {
  nameCarried = "Carried House";
  slugCarried = `carried-${randomUUID().slice(0, 8)}`;
  const [org] = await db
    .insert(orgs)
    .values({ name: nameCarried, slug: slugCarried })
    .returning({ id: orgs.id });
  orgCarried = org!.id;

  const [event] = await db
    .insert(events)
    .values({ orgId: orgCarried, name: "Carried Sale" })
    .returning({ id: events.id });
  const [catalogue] = await db
    .insert(catalogues)
    .values({ orgId: orgCarried, eventId: event!.id, name: "Carried Sale catalogue" })
    .returning({ id: catalogues.id });
  catalogueCarried = catalogue!.id;
  const made = await db
    .insert(lots)
    .values([
      { orgId: orgCarried, eventId: event!.id, ref: "K01" },
      { orgId: orgCarried, eventId: event!.id, ref: "K02" },
      { orgId: orgCarried, eventId: event!.id, ref: "K03" },
    ])
    .returning({ id: lots.id });

  await db.insert(overrides).values([
    // Two decisions a specialist made: do not print this field in this
    // catalogue. `{hidden: <bool>}` is the whole of what the script carries.
    {
      orgId: orgCarried,
      catalogueId: catalogueCarried,
      lotId: made[0]!.id,
      field: "maker",
      value: { hidden: true },
      decidedBy: null,
    },
    {
      orgId: orgCarried,
      catalogueId: catalogueCarried,
      lotId: made[1]!.id,
      field: "description",
      value: { hidden: true },
      decidedBy: null,
    },
    // And one the predecessor stored for its other columns' sake, whose hidden
    // flag was false. It is still a carried row; it simply asserts nothing.
    {
      orgId: orgCarried,
      catalogueId: catalogueCarried,
      lotId: made[2]!.id,
      field: "price",
      value: { hidden: false },
      decidedBy: null,
    },
    // A PROPOSAL, in the shape the same script writes: a composite field key,
    // and `proposal` in the value. Nobody has answered it.
    {
      orgId: orgCarried,
      catalogueId: catalogueCarried,
      lotId: made[0]!.id,
      field: "title:crop",
      value: { proposal: true, kind: "crop", state: "open", assetHash: "c0ffee" },
      decidedBy: null,
    },
  ]);
}

/** A second house with nothing but an open proposal, and so nothing to decide. */
async function seedProposalOnlyHouse(): Promise<void> {
  slugProposalOnly = `proposed-${randomUUID().slice(0, 8)}`;
  const [org] = await db
    .insert(orgs)
    .values({ name: "Proposal House", slug: slugProposalOnly })
    .returning({ id: orgs.id });
  orgProposalOnly = org!.id;
  const [event] = await db
    .insert(events)
    .values({ orgId: orgProposalOnly, name: "Proposed Sale" })
    .returning({ id: events.id });
  const [catalogue] = await db
    .insert(catalogues)
    .values({ orgId: orgProposalOnly, eventId: event!.id, name: "Proposed catalogue" })
    .returning({ id: catalogues.id });
  const [lot] = await db
    .insert(lots)
    .values({ orgId: orgProposalOnly, eventId: event!.id, ref: "Q01" })
    .returning({ id: lots.id });
  await db.insert(overrides).values({
    orgId: orgProposalOnly,
    catalogueId: catalogue!.id,
    lotId: lot!.id,
    field: "title:straighten",
    value: { proposal: true, kind: "straighten", state: "open", assetHash: "c0ffee" },
    decidedBy: null,
  });
}

async function timestamps(orgId: string): Promise<Map<string, number>> {
  const rows = await db
    .select({ field: overrides.field, updatedAt: overrides.updatedAt })
    .from(overrides)
    .where(eq(overrides.orgId, orgId));
  return new Map(rows.map((r) => [r.field, r.updatedAt.getTime()]));
}

const fieldsOf = (rows: OverrideRow[]): string[] => rows.map((r) => r.field).sort();

beforeAll(async () => {
  const admin = new Pool({ connectionString: HOME, max: 1 });
  try {
    await admin.query(`create database "${SCRATCH}"`);
  } finally {
    await admin.end();
  }
  // Before the first getDb(), which is lazy precisely so this is possible.
  process.env.DATABASE_URL = urlFor(SCRATCH);

  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS });
  } finally {
    await pool.end();
  }

  db = getDb();
  await seedCarriedHouse();
  await seedProposalOnlyHouse();

  touchedBefore = await timestamps(orgCarried);
  before = await listOverrides(orgCarried, catalogueCarried);
  await runBackfill();
  after = await listOverrides(orgCarried, catalogueCarried);
}, 60_000);

afterAll(async () => {
  await getPool().end();
  process.env.DATABASE_URL = HOME;
  const admin = new Pool({ connectionString: HOME, max: 1 });
  try {
    await admin.query(`drop database if exists "${SCRATCH}" with (force)`);
  } finally {
    await admin.end();
  }
});

describe("the decisions carried from the predecessor", () => {
  it("reach the engine only after the backfill", () => {
    // The defect, stated as a measurement: two specialists' decisions, sitting
    // in the table, applied to nothing.
    expect(fieldsOf(before)).toEqual([]);
    expect(fieldsOf(after)).toEqual(["description", "maker"]);
    expect(after.every((row) => row.hidden === true)).toBe(true);
  });

  it("keep the day they were decided; only who decided them is written", async () => {
    // The row's content did not change and neither did its age. A touch here
    // would have every carried decision claim it was edited on the day of the
    // deployment, which is the one thing about them that is not true.
    expect(await timestamps(orgCarried)).toEqual(touchedBefore);
  });

  it("include the one that asserts nothing, which the reader still skips", async () => {
    // `{hidden: false}` is a carried row and gets a decider like the rest. It
    // stays out of `after` because overrideFromValue finds nothing in it to
    // apply — the reader's rule, not the migration's, and the two are separate
    // on purpose.
    const [priced] = await db
      .select({ decidedBy: overrides.decidedBy })
      .from(overrides)
      .where(and(eq(overrides.orgId, orgCarried), eq(overrides.field, "price")));
    expect(priced!.decidedBy).not.toBeNull();
    expect(fieldsOf(after)).not.toContain("price");
  });
});

describe("a proposal is not an edit", () => {
  it("is left undecided, however the migration is run", async () => {
    const undecided = await db
      .select({ field: overrides.field })
      .from(overrides)
      .where(and(eq(overrides.orgId, orgCarried), isNull(overrides.decidedBy)));
    expect(undecided.map((r) => r.field)).toEqual(["title:crop"]);
    expect(fieldsOf(after)).not.toContain("title:crop");
  });

  it("earns its house no gate identity, because there is nobody to name", async () => {
    // The second house holds one open proposal and nothing else. A migration
    // that made a person for every tenant in order to name none of them would
    // leave rows nobody could account for.
    const made = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, gateEmail(slugProposalOnly)));
    expect(made).toHaveLength(0);
    const stillNull = await db
      .select({ id: overrides.id })
      .from(overrides)
      .where(and(eq(overrides.orgId, orgProposalOnly), isNull(overrides.decidedBy)));
    expect(stillNull).toHaveLength(1);
  });
});

describe("who the migration named", () => {
  it("is the same person currentActorId finds afterwards", async () => {
    // THE ASSERTION THIS FILE EXISTS FOR. The gate address is written in
    // TypeScript in src/lib/data/actor.ts and again in SQL in the migration,
    // because a migration runs before any request and cannot call the former.
    // Duplication drifts; this is what notices. If the two ever disagree the
    // migration's rows point at an identity the application never names, and
    // every carried decision reads as somebody else's.
    const [gate] = await db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(eq(users.email, gateEmail(slugCarried)));
    expect(gate).toBeDefined();
    expect(gate!.name).toBe(`${nameCarried} — via the gate`);
    expect(await currentActorId(orgCarried)).toBe(gate!.id);

    const decided = await db
      .select({ decidedBy: overrides.decidedBy })
      .from(overrides)
      .where(and(eq(overrides.orgId, orgCarried), eq(overrides.field, "maker")));
    expect(decided[0]!.decidedBy).toBe(gate!.id);
  });

  it("is a member of the house, which currentActorId would never have added", async () => {
    // currentActorId returns early when the user already exists and never
    // reaches its membership insert. An identity this migration created without
    // a membership would therefore never acquire one.
    const held = await db
      .select({ role: memberships.role })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(
        and(eq(memberships.orgId, orgCarried), eq(users.email, gateEmail(slugCarried))),
      );
    expect(held.map((m) => m.role)).toEqual(["member"]);
  });
});

describe("running it twice", () => {
  it("changes nothing and duplicates nobody", async () => {
    const countAll = async () => ({
      gates: (
        await db.select({ id: users.id }).from(users).where(eq(users.email, gateEmail(slugCarried)))
      ).length,
      memberships: (
        await db.select({ id: memberships.id }).from(memberships).where(eq(memberships.orgId, orgCarried))
      ).length,
      undecided: (
        await db.select({ id: overrides.id }).from(overrides).where(isNull(overrides.decidedBy))
      ).length,
    });

    const first = await countAll();
    await runBackfill();
    expect(await countAll()).toEqual(first);
    expect(await timestamps(orgCarried)).toEqual(touchedBefore);
    expect(fieldsOf(await listOverrides(orgCarried, catalogueCarried))).toEqual([
      "description",
      "maker",
    ]);
  });
});
