// Events, and the counts the landing page shows against each.
//
// Every function here takes `orgId` as its first argument rather than resolving
// it internally. That is not ceremony: it makes "did this query scope to a
// tenant?" answerable by reading the call, and it keeps the data layer usable
// from a script, a job or a test that has no request context.

import { and, desc, eq, sql } from "drizzle-orm";

import { events, getDb } from "@/db";

export interface EventSummary {
  id: string;
  name: string;
  heldOn: Date | null;
  createdAt: Date;
  /** What the landing page's progress columns are made of. */
  lotCount: number;
  /** Lots with at least one photograph attached. */
  photographedCount: number;
}

export async function listEvents(orgId: string): Promise<EventSummary[]> {
  const db = getDb();
  // Counted in ONE query with correlated subqueries rather than N+1.
  //
  // THE TABLE AND COLUMN NAMES ARE WRITTEN OUT, and that is not laziness — it is
  // the fix for a bug this exact function had. Interpolating drizzle columns into
  // a `sql` template renders them UNQUALIFIED:
  //
  //     sql`… from ${lots} where ${lots.eventId} = ${events.id}`
  //     →  select count(*)::int from "lots" where "event_id" = "id"
  //
  // Inside the subquery both names then resolve against `lots`, so the condition
  // compares lots.event_id to lots.id, is never true, and every count comes back
  // ZERO. Nothing errors; the page just lies. That is what shipped in the
  // predecessor, and it reproduced here the first time this ran.
  //
  // Two guards keep it fixed: the test below asserts the counts against known
  // data, and another asserts the generated SQL still carries the qualified
  // names — so "tidying" this back into interpolation fails rather than silently
  // returning zeros again.
  const rows = await db
    .select({
      id: events.id,
      name: events.name,
      heldOn: events.heldOn,
      createdAt: events.createdAt,
      lotCount: sql<number>`(
        select count(*)::int from lots where lots.event_id = events.id
      )`,
      photographedCount: sql<number>`(
        select count(*)::int from lots
        where lots.event_id = events.id
          and exists (
            select 1 from lot_assets where lot_assets.lot_id = lots.id
          )
      )`,
    })
    .from(events)
    .where(eq(events.orgId, orgId))
    .orderBy(desc(events.createdAt));

  return rows.map((r) => ({
    ...r,
    lotCount: Number(r.lotCount),
    photographedCount: Number(r.photographedCount),
  }));
}

export async function getEvent(
  orgId: string,
  eventId: string,
): Promise<typeof events.$inferSelect | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(events)
    // BOTH conditions, always. Addressing by id alone is how one tenant reads
    // another's row by guessing a UUID — and the predecessor's entire API did
    // exactly that, with no ownership check anywhere.
    .where(and(eq(events.orgId, orgId), eq(events.id, eventId)))
    .limit(1);
  return row ?? null;
}

export async function createEvent(
  orgId: string,
  input: { name: string; heldOn?: Date | null },
): Promise<typeof events.$inferSelect> {
  const db = getDb();
  const [row] = await db
    .insert(events)
    .values({
      orgId,
      name: input.name.trim(),
      heldOn: input.heldOn ?? null,
    })
    .returning();
  return row!;
}

/** How many events the org has. For the rail, which must not load them all. */
export async function countEvents(orgId: string): Promise<number> {
  const db = getDb();
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(events)
    .where(eq(events.orgId, orgId));
  return Number(row?.n ?? 0);
}
