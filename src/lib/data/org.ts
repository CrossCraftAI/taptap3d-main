// Which org is acting.
//
// IT WAS A STOPGAP WRITTEN TO DIE, and half of it has. Sign-in landed, so
// there IS a person to ask which house they belong to, and the membership
// branch below is that question. The rest stays because the deployment is
// still pinned to one org by TAPTAP3D_ORG_SLUG while the move off Fly is
// planned, and because a machine with no Google project — every developer's,
// and every end-to-end run — has no session to read.
//
// The original reasoning, which still holds for the unsigned path:
// there was no user to ask which org they belong to — but
// ARCHITECTURE.md principle 7 says every row carries `org_id` from the first
// commit, and that rule is worth nothing if the application writes a hardcoded
// constant into it.
//
// So the org is RESOLVED, not assumed, and the resolution is deliberately
// fragile in the one way that matters: if there is more than one org, it refuses
// rather than picking. A silent "pick the first" would work perfectly on a
// single-tenant development machine and start mixing two customers' data the
// first time it did not.
//
// When auth lands, this file is replaced by a session lookup and nothing that
// calls `currentOrgId()` changes shape.

import { eq, sql } from "drizzle-orm";

import { getDb, memberships, orgs } from "@/db";
import { authConfigured, currentSession } from "@/lib/auth/session";
import { policyFor, type FieldPolicy } from "@/lib/engine/visibility";

export class NoOrgError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NoOrgError";
  }
}

/**
 * The acting org.
 *
 * `TAPTAP3D_ORG_SLUG` names one explicitly — which is how a second org becomes
 * possible before auth exists, and how a deployment pins itself to one tenant.
 * Otherwise there must be exactly one.
 */
export async function currentOrgId(): Promise<string> {
  const db = getDb();
  const slug = process.env.TAPTAP3D_ORG_SLUG;

  if (slug) {
    const [row] = await db
      .select({ id: orgs.id })
      .from(orgs)
      .where(eq(orgs.slug, slug))
      .limit(1);
    if (!row) {
      throw new NoOrgError(
        `TAPTAP3D_ORG_SLUG is "${slug}" but no org has that slug.`,
      );
    }
    return row.id;
  }

  // ── THE SIGNED-IN PERSON'S OWN HOUSE, WHEN THERE IS ONE ───────────────────
  //
  // AFTER the env slug and not before it, which is the whole shape of the
  // deployment right now: Fly stays pinned to a single org while the move to
  // GCP is planned, so the variable is set there and this branch never runs
  // in production yet. It runs locally and in the tests, and it is what makes
  // two houses possible the day the pin comes off.
  //
  // STILL EXACTLY ONE ANSWER OR NONE. A person who is a member of two houses
  // is the org switcher's problem (ROADMAP D14, scheduled as S3) and this
  // must not guess between them — a write that picks a tenant by fetch order
  // is the failure this function has refused since the first commit. So two
  // memberships throws exactly as two orgs always did.
  // ── IF SIGN-IN IS CONFIGURED, SIGN-IN IS REQUIRED ────────────────────────
  //
  // THE HOLE THIS CLOSES. `src/proxy.ts` can only look at whether a session
  // COOKIE is present — Next's own guidance is that proxy code must not reach
  // for shared modules or a database, and it runs before the application. So
  // a forged cookie gets past the proxy, and if this function then fell
  // through to "there is exactly one org, use it", the forgery would be a
  // full sign-in. The proxy is a redirect for people who are not signed in;
  // THIS is the check.
  //
  // Guarded on `authConfigured` rather than applied always, because a machine
  // with no Google project must keep working exactly as it did — every e2e
  // spec in this repository builds a sale against one.
  const signedIn = await currentSession();
  if (authConfigured() && !signedIn) {
    throw new NoOrgError("Not signed in.");
  }
  if (signedIn) {
    const mine = await db
      .select({ id: memberships.orgId })
      .from(memberships)
      .where(eq(memberships.userId, signedIn.userId))
      .limit(2);
    if (mine.length === 1) return mine[0]!.id;
    if (mine.length > 1) {
      throw new NoOrgError(
        `${signedIn.email} is a member of more than one house and there is no ` +
          "switcher yet. Set TAPTAP3D_ORG_SLUG to choose one.",
      );
    }
    // Zero is not a fall-through to "the only org": a person whose membership
    // was removed must not keep working because the database happens to hold
    // one house. `admit` refuses them at the door; this refuses them if the
    // row goes away while they are signed in.
    throw new NoOrgError(`${signedIn.email} is not a member of any house.`);
  }

  // Two is fetched rather than one, so "there are several" is distinguishable
  // from "there is one". Asking for one row would make the ambiguous case
  // indistinguishable from the fine case, which is the failure this exists to
  // prevent.
  const rows = await db.select({ id: orgs.id, slug: orgs.slug }).from(orgs).limit(2);

  if (rows.length === 0) {
    throw new NoOrgError(
      "No organisation exists yet. Run `npm run db:seed` to create one.",
    );
  }
  if (rows.length > 1) {
    throw new NoOrgError(
      "More than one organisation exists and nobody is signed in. " +
        "Set TAPTAP3D_ORG_SLUG to choose one.",
    );
  }
  return rows[0]!.id;
}

/**
 * The acting org as a row, or null when there is not exactly one.
 *
 * The shell needs to render SOMETHING on a machine with no org yet — a chrome
 * that throws leaves a blank page and no way to find out why. `currentOrgId`
 * stays strict because a write must never guess which tenant it is writing for;
 * this one is for chrome, and it says "not resolved" instead of refusing.
 */
export async function currentOrgOrNull(): Promise<
  typeof orgs.$inferSelect | null
> {
  try {
    const id = await currentOrgId();
    const db = getDb();
    const [row] = await db.select().from(orgs).where(eq(orgs.id, id)).limit(1);
    return row ?? null;
  } catch (error) {
    if (error instanceof NoOrgError) return null;
    throw error;
  }
}

/**
 * What this house has said about which of its fields may leave the building.
 *
 * TOTAL, and it never throws: an org with no row for its policy, a column that
 * is null, and a column holding something written by a later version of the
 * schema all come back as a policy the engine can apply. `policyFor` is where
 * that is decided (src/lib/engine/visibility.ts) and this function does not
 * second-guess it — a reader that could refuse a stored value is a catalogue
 * nobody can print, which is the same rule `overrideFromValue` follows.
 *
 * READ PER DERIVATION, not cached. It is one indexed row by primary key
 * alongside the several queries every catalogue render already makes, and a
 * cache here would mean a house that has just marked its reserve `house` keeps
 * printing it until something expires — a stale answer in the one place where
 * a stale answer is a disclosure.
 */
export async function fieldPolicyOf(orgId: string): Promise<FieldPolicy> {
  const db = getDb();
  const [row] = await db
    .select({ fieldPolicy: orgs.fieldPolicy })
    .from(orgs)
    .where(eq(orgs.id, orgId))
    .limit(1);
  return policyFor(row?.fieldPolicy);
}

/**
 * Set it, whole.
 *
 * WHOLE AND NOT A PATCH, which is the opposite of how an override is written
 * (src/lib/data/overrides.ts merges, and says at length why). The difference is
 * that an override row is written by two gestures that know nothing of each
 * other — a drag in the editor and a save on the lot form — so a replace there
 * destroys work. A policy is one map edited in one place by one person, and a
 * merge would make "stop holding this field back" impossible to express: an
 * absent key would mean "leave it alone" rather than "it is public again", and
 * un-marking a field would need a sentinel value that means the absence the map
 * can already express.
 *
 * Normalised through `policyFor` on the way in, so what is stored is what will
 * be read back — the same one-rule-one-implementation the override writer uses
 * to make its round trip provable.
 *
 * ── IT HAS A SCREEN NOW ────────────────────────────────────────────────────
 *
 * `/settings` (src/app/settings/page.tsx). This used to say the writer's only
 * callers were the tests and the seed, and that a house set its policy by hand
 * in SQL; that is no longer true, and the whole-map contract above is what the
 * screen is built on — the form states every field it drew, so un-marking one
 * is expressible and there is no sentinel meaning "public again".
 *
 * WHAT THE SCREEN MUST NOT DO, said here because this is the function that
 * would let it: it must not store `"public"`. An absent key is the default and
 * the default is that nothing changes, so a screen that wrote every field's
 * level would turn "the house has said nothing" into "the house has said
 * public about all forty of these" — identical in behaviour today and a
 * different sentence the day anything reads the policy's size.
 * `policyOf` in src/lib/settings.ts is where that is enforced.
 */
export async function setFieldPolicy(
  orgId: string,
  policy: Record<string, unknown>,
): Promise<FieldPolicy> {
  const clean = policyFor(policy);
  const db = getDb();
  await db
    .update(orgs)
    // Spread into a plain object: `policyFor` returns a frozen, null-prototype
    // map, and what goes to the driver should be an ordinary JSON object.
    .set({ fieldPolicy: { ...clean }, updatedAt: new Date() })
    .where(eq(orgs.id, orgId));
  return clean;
}

/** A field key a house's records actually carry, and how many carry it. */
export interface DiscoveredField {
  key: string;
  /** Lots of this org holding a value under that key. */
  lots: number;
}

/**
 * The field keys this house's own records use.
 *
 * ── WHY THIS HAS TO BE DISCOVERED AT ALL ────────────────────────────────────
 *
 * There is no `fields` table and there is deliberately not going to be one
 * (src/db/schema.ts says so on `orgs.field_policy`): a lot's field set is the
 * CUSTOMER's, arrives at import, and `lots.fields` is open jsonb. `CORE_FIELDS`
 * is the part this system named — nine columns derived from a real corpus —
 * and 保留價 is not in it and never will be. So a screen that offers a house
 * its own fields has to ask the rows what they are called.
 *
 * ── ONE SCAN, AND IT IS ONE SCREEN'S ────────────────────────────────────────
 *
 * `jsonb_object_keys` is a set-returning function, so this reads every lot of
 * the org and expands each one's keys. That is a full scan of the org's lots
 * and it has no index that could help it: the question is about the keys
 * INSIDE a jsonb document, and a b-tree over the column answers nothing about
 * them. It is acceptable here and it would not be on a page somebody loads all
 * day — this is the settings screen, opened when a house changes its mind about
 * what may be printed.
 *
 * The day it is not acceptable, what changes is not this function: it is that
 * the key set stops being derived and starts being recorded, by the importer,
 * as it maps columns. That is a column on `events` or a small table, it is a
 * write by the one thing that already knows the answer, and it is not needed
 * until a house has a hundred thousand lots.
 *
 * `jsonb_typeof` guards the expansion: `jsonb_object_keys` RAISES on an array
 * or a scalar, and this column is open jsonb written by an importer, so a row
 * that is not an object would take the settings screen down rather than being
 * skipped. The count is per KEY and not per value — a lot holding an empty
 * string under 保留價 still names the column, which is the question the screen
 * is asking.
 */
export async function listFieldKeys(orgId: string): Promise<DiscoveredField[]> {
  const db = getDb();
  // RAW, the way src/lib/data/movements.ts `placesInUse` is, and for the same
  // reason: a LATERAL set-returning join is not something the query builder
  // expresses, and writing the table and column names out is what keeps them
  // qualified. `db.execute<T>` takes T on trust — it shapes nothing — so the
  // two casts below are the shape, and the `Number()` is not superfluous:
  // the driver returns `count(*)` as a string without it.
  const result = await db.execute<{ key: string; lots: number }>(sql`
    select k.key as key, count(*)::int as lots
    from lots, lateral jsonb_object_keys(lots.fields) as k(key)
    where lots.org_id = ${orgId}
      and jsonb_typeof(lots.fields) = 'object'
    group by k.key
    order by count(*) desc, k.key asc
  `);
  return result.rows.map((row) => ({ key: row.key, lots: Number(row.lots) }));
}
