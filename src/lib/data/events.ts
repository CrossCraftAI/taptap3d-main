// Events, and the counts the landing page shows against each.
//
// Every function here takes `orgId` as its first argument rather than resolving
// it internally. That is not ceremony: it makes "did this query scope to a
// tenant?" answerable by reading the call, and it keeps the data layer usable
// from a script, a job or a test that has no request context.

import { and, desc, eq, sql } from "drizzle-orm";

import { events, getDb } from "@/db";
import type { StageFacts } from "@/lib/workflow";

export interface EventSummary {
  id: string;
  name: string;
  heldOn: Date | null;
  createdAt: Date;
  /** What the landing page's progress columns are made of. */
  lotCount: number;
  /** Lots with at least one photograph attached. */
  photographedCount: number;
  /** Catalogues opened for this event. One, usually; zero until somebody looks. */
  catalogueCount: number;
  /** Catalogues whose PDF has been taken at least once. */
  exportedCount: number;
  /**
   * The stage a person set, or null for "as the data says". A stage id in the
   * workflow's vocabulary, resolved by `readStage`; see src/lib/workflow.ts.
   */
  stageOverride: string | null;
}

/** The four counts the workflow reads, under the names its rules use. */
export function factsOf(summary: EventSummary): StageFacts {
  return {
    lots: summary.lotCount,
    photographed: summary.photographedCount,
    catalogues: summary.catalogueCount,
    exported: summary.exportedCount,
  };
}

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
//
// ONE SHAPE FOR THE LEDGER AND THE EVENT PAGE. Both read a stage from these
// numbers, and two queries would be two chances to count differently — the
// event page once computed "photographed" from its own lot list while the
// ledger counted in SQL, and the stage would have flickered between them.
const SUMMARY = {
  id: events.id,
  name: events.name,
  heldOn: events.heldOn,
  createdAt: events.createdAt,
  stageOverride: events.stageOverride,
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
  catalogueCount: sql<number>`(
    select count(*)::int from catalogues where catalogues.event_id = events.id
  )`,
  exportedCount: sql<number>`(
    select count(*)::int from catalogues
    where catalogues.event_id = events.id
      and catalogues.exported_at is not null
  )`,
};

/** What one row of `SUMMARY` comes back as, before the counts are coerced. */
interface SummaryRow {
  id: string;
  name: string;
  heldOn: Date | null;
  createdAt: Date;
  stageOverride: string | null;
  lotCount: number;
  photographedCount: number;
  catalogueCount: number;
  exportedCount: number;
}

function toSummary(r: SummaryRow): EventSummary {
  return {
    ...r,
    // Numbers, not strings — node-postgres returns bigint counts as text, which
    // is how a count becomes "3" and a sum becomes "33".
    lotCount: Number(r.lotCount),
    photographedCount: Number(r.photographedCount),
    catalogueCount: Number(r.catalogueCount),
    exportedCount: Number(r.exportedCount),
  };
}

export async function listEvents(orgId: string): Promise<EventSummary[]> {
  const db = getDb();
  const rows = await db
    .select(SUMMARY)
    .from(events)
    .where(eq(events.orgId, orgId))
    .orderBy(desc(events.createdAt));
  return rows.map(toSummary);
}

/** One event with the same counts the ledger shows, so the two cannot disagree. */
export async function getEventSummary(
  orgId: string,
  eventId: string,
): Promise<EventSummary | null> {
  const db = getDb();
  const [row] = await db
    .select(SUMMARY)
    .from(events)
    // Both conditions, always — see getEvent.
    .where(and(eq(events.orgId, orgId), eq(events.id, eventId)))
    .limit(1);
  return row ? toSummary(row) : null;
}

/**
 * Set where the sale is, by hand — or take that answer back.
 *
 * `stage` is a stage id the caller has already checked against the workflow,
 * or null to return to the derived reading (principle 9: reversible, in the
 * same place it was set). The data layer does not know the workflow and does
 * not validate the id: `readStage` is total over whatever is stored, so a
 * stale id shows as derived rather than as an error.
 *
 * True when a row was changed; false when the event is not this org's.
 */
export async function setStageOverride(
  orgId: string,
  eventId: string,
  stage: string | null,
): Promise<boolean> {
  const db = getDb();
  const rows = await db
    .update(events)
    .set({ stageOverride: stage, updatedAt: new Date() })
    .where(and(eq(events.orgId, orgId), eq(events.id, eventId)))
    .returning({ id: events.id });
  return rows.length > 0;
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

export interface EventChoice {
  id: string;
  name: string;
  heldOn: Date | null;
  lotCount: number;
}

/**
 * Every event in the org, as little of it as a switcher needs.
 *
 * NOT `listEvents`. The shell renders on every request, and the ledger's
 * summary costs four correlated subqueries an event to answer questions — how
 * many are photographed, whether a catalogue exists, whether it has been
 * exported — that a menu of names has no use for. This carries the one count
 * that changes what the chrome OFFERS rather than what it says: nothing prints
 * from a sale with no lots, so the palette's PDF row is not there for one
 * (src/lib/palette.ts, and src/app/exports/page.tsx made the same call). The
 * rail's Lots number is that same count, read from the same row.
 *
 * It also replaces `countEvents` for the rail's Events number — the rail's
 * count is this list's length, so naming the whole set costs no extra query.
 * THAT IS ONLY TRUE WHILE THE SET IS WHOLE. The day this grows a `limit`, the
 * rail's number has to come from `countEvents` in the same breath, or the rail
 * quietly starts reporting the size of a menu instead of the size of a house.
 *
 * MOST RECENTLY TOUCHED FIRST, with creation as the tiebreak — `updated_at`
 * and `created_at` are equal until something writes the row, so a house that
 * has never overruled a stage gets exactly the newest-first order this had
 * before. The order is load-bearing now: the switcher paints ten of these
 * (src/lib/nav.ts `switcherRows`) and the ten it paints are the head of this
 * list.
 *
 * ONE QUERY AND THE WHOLE SET, as `listLotChoices` does. The menu is capped in
 * the COMPONENT rather than here, and that is forced rather than preferred:
 * this is called from the root layout, which cannot know which sale is open —
 * Next's layout documentation says a layout does not read the pathname because
 * it does not re-render on navigation — so a `limit` here would be a server
 * choosing rows without knowing the one row three parts of the chrome are
 * about to look up. src/lib/nav.ts carries the measurement and the rest of the
 * argument.
 */
export async function listEventChoices(orgId: string): Promise<EventChoice[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: events.id,
      name: events.name,
      heldOn: events.heldOn,
      // Written out, unqualified names avoided — see the note above SUMMARY.
      lotCount: sql<number>`(
        select count(*)::int from lots where lots.event_id = events.id
      )`,
    })
    .from(events)
    .where(eq(events.orgId, orgId))
    .orderBy(desc(events.updatedAt), desc(events.createdAt));
  return rows.map((r) => ({ ...r, lotCount: Number(r.lotCount) }));
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
