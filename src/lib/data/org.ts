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
