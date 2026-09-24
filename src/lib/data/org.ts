// Which org is acting.
//
// THIS IS A STOPGAP AND IT IS WRITTEN TO DIE. There is no authentication yet
// (ROADMAP D14), so there is no user to ask which org they belong to — but
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

import { eq } from "drizzle-orm";

import { getDb, orgs } from "@/db";
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
      "More than one organisation exists and there is no sign-in yet. " +
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
 * ── IT HAS NO SCREEN YET, AND THAT IS NAMED RATHER THAN HIDDEN ─────────────
 *
 * Its callers today are the tests that prove the column round-trips and the
 * seed. A house sets its policy by hand until the settings screen lands, and
 * the lot record says where every value goes so that a policy set by hand is at
 * least legible. Shipping the writer with the reader is what keeps the two
 * normalising through one function; shipping a screen for it was not this
 * phase's work.
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
