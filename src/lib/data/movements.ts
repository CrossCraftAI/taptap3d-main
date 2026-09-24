// Movement: where a thing is, as a chain of the times it moved.
//
// ── WHERE IT IS, IS NOT STORED ──────────────────────────────────────────────
//
// The current location is the last movement's `to_place`, derived on every
// read. There is no column on `lots` and there is not going to be one:
// ARCHITECTURE.md principle 2 — nothing stored that the engine cannot
// re-derive — and the failure the rule exists for is exactly the one a
// location column produces. A denormalised place drifts the first time a
// movement's date is corrected or a row is removed, and the drift is silent,
// because the two answers live on two screens.
//
// The consequence a registrar feels: CORRECTING A LOCATION APPENDS. "It is not
// at the saleroom, it is still in Kwai Chung" is a new movement dated when the
// correction is made, not an edit to the leg that was wrong. Both readings stay
// in the chain and the catalogue can still be asked which of them was public.
// This is the same shape as the workflow stage (src/lib/workflow.ts): derived
// from facts, and a person who knows better says so in a way the system keeps.
//
// ── WHAT IS DERIVED HERE THAT LOOKS LIKE IT SHOULD BE STORED ────────────────
//
// A CRATE. A crate is a PLACE, so packing forty lots writes forty movements
// whose `to_place` is the crate, and the crate's contents are the lots whose
// LAST movement points at it. No crate table, no membership rows, and a lot
// lifted out by hand cannot leave a stale membership behind saying it is still
// inside. `placesInUse` is that query.
//
// A GESTURE. "Moved as one gesture" — the forty — is not a column either: it
// is the movements that share an instant, an origin and a destination. One
// insert statement gives them all the same `occurred_at`, and `movedWith`
// counts them back out. Storing a batch id would be storing what the values
// already say, and would be wrong the moment two of the forty were corrected
// separately.
//
// ── THE PRINT PATH READS THIS TABLE, AT EXACTLY ONE COLUMN ──────────────────
//
// `is_public` is what turns a custody leg into a PROVENANCE line. One chain,
// two audiences, so a registrar types the facts once; the predecessor's
// competitor keeps custody and provenance in two tabs and makes them type it
// twice, which is how the catalogue and the custody record come to disagree.
// `provenanceOf` below is the whole of that derivation, and the movement screen
// shows its output verbatim so that "what the catalogue would print" is the
// same function and not a second description of it.

import { and, eq, sql } from "drizzle-orm";

import { getDb, lots, movements } from "@/db";

/** How long a place name may be. A place is a string a house types. */
export const MAX_PLACE = 120;
/** A note is prose; a reason is a phrase. Both are bounded, neither is an enum. */
export const MAX_NOTE = 4_000;

/**
 * One leg of the chain, with the two facts about it that are counted rather
 * than stored.
 */
export interface MovementLeg {
  id: string;
  occurredAt: Date;
  /** Null on an arrival: the lot came from somewhere this system never held. */
  fromPlace: string | null;
  toPlace: string;
  custodian: string | null;
  reason: string | null;
  note: string | null;
  isPublic: boolean;
  /**
   * How many lots made this move in the same gesture, THIS ONE INCLUDED — so
   * one is the ordinary case and forty is a crate. Derived from the movements
   * sharing an instant, an origin and a destination; see the header.
   */
  movedWith: number;
  /** Examinations filed against this handoff. Zero reads as "no report". */
  reports: number;
}

/**
 * Where a lot is, and who has it.
 *
 * `null` from `whereItIs` means NOWHERE RECORDED, which is not the same as
 * "lost" and not the same as "at the house". Every lot imported before this
 * table existed is in that state and the screen says so, because inventing a
 * first movement would be putting a fact nobody witnessed into a chain a claim
 * is argued from.
 */
export interface Whereabouts {
  place: string;
  custodian: string | null;
  since: Date;
  /** How many other lots are in the same place. One means it is there alone. */
  alongside: number;
}

/**
 * Where the chain says it is.
 *
 * THE CHAIN ARRIVES NEWEST FIRST — the order it is painted in — so the current
 * place is its head. PURE, so the rule "the last movement's to_place" is held
 * by a test over an array rather than only by driving a browser, and so the
 * register and the lot's own screen cannot come to different answers.
 */
export function whereItIs(chain: readonly MovementLeg[]): Omit<Whereabouts, "alongside"> | null {
  const last = chain[0];
  if (!last) return null;
  return { place: last.toPlace, custodian: last.custodian, since: last.occurredAt };
}

/**
 * One line of provenance, as the catalogue would print it.
 *
 * ── WHY THE PLACE IS THE LEG'S ORIGIN AND NOT ITS DESTINATION ───────────────
 *
 * Provenance is a list of who HELD a thing, and a leg records it leaving
 * somebody. So the public leg "Lin family collection, Taipei → Photography
 * studio" prints "Lin family collection, Taipei", dated when it left. That is
 * also what a registrar means when they tick the box on that leg: the tick is
 * on the arrival because the arrival is when the house learned the fact, and
 * the fact is about where it came from.
 *
 * A public leg with no origin prints NOTHING and is skipped. An arrival from
 * nowhere has no holder to name, and "acquired from —" in a printed catalogue
 * is worse than a shorter provenance.
 */
export interface ProvenanceEntry {
  /** The holder, as the chain names the place. */
  place: string;
  /** When it left them. */
  until: Date;
  /** The house's own words for the occasion, or null. */
  reason: string | null;
}

/**
 * Every public leg as provenance, OLDEST FIRST — the order a catalogue prints
 * it, which is the reverse of the order a registrar reads the chain in.
 *
 * PURE, and it is the only definition of "what the catalogue would print". The
 * movement screen renders its output rather than describing it, so the box on
 * that screen cannot drift from the page (§2 of the brief asks for exactly
 * that, and a second description is how the two come to disagree).
 */
export function provenanceOf(chain: readonly MovementLeg[]): ProvenanceEntry[] {
  return chain
    .filter((leg) => leg.isPublic && leg.fromPlace !== null)
    .map((leg) => ({ place: leg.fromPlace!, until: leg.occurredAt, reason: leg.reason }))
    .reverse();
}

/**
 * One entry as a printed string.
 *
 * ENGLISH ONLY, and for the reason `shortfallOf` gives in src/lib/workflow.ts:
 * a `zh` half here would be a string no screen reads and no test can hold to
 * account. It arrives when the interface picks a language, and for the whole
 * interface at once.
 *
 * The date is a YEAR. A catalogue's provenance reads "Lin family collection,
 * Taipei, until 2019" — a day and a month is warehouse detail, and printing it
 * would put the house's internal movements in front of a bidder.
 */
export function provenanceLine(entry: ProvenanceEntry): string {
  return `${entry.place}, until ${entry.until.getUTCFullYear()}`;
}

/** Every public leg as the catalogue's provenance field: one line each. */
export function provenanceText(chain: readonly MovementLeg[]): string {
  return provenanceOf(chain).map(provenanceLine).join("\n");
}

/**
 * A moment as the custody screens print it.
 *
 * ASIA/HONG_KONG, the same fixed zone src/components/ledger.tsx pins its dates
 * to and for the same reason with more force: a chain is read where the thing
 * physically is, and a server in another zone must not report a crate leaving
 * on the wrong day. The TIME is here and is not on the ledger, because a
 * custody record is argued to the hour — "it was collected at 09:40" — while a
 * sale date is a day.
 *
 * FORMATTED ON THE SERVER, always. These strings cross into client components
 * as text, because a client that formats a date rehydrates a different one
 * from the machine that rendered it.
 */
/**
 * A timestamp out of a RAW SQL row, as a Date.
 *
 * ── THE ROW TYPE IS A PROMISE ABOUT THE CALLER, NOT ABOUT THE DRIVER ────────
 *
 * `db.execute<T>` takes T on trust: it shapes nothing and parses nothing, so a
 * field declared `Date` is whatever the driver put there. Through drizzle's
 * node-postgres wrapper a `timestamptz` arrives as a STRING, and every one of
 * these columns is read through raw SQL because the house rule is to spell the
 * names out (src/lib/data/events.ts records the defect that rule exists for).
 *
 * MEASURED, and it cost a page. `Intl.DateTimeFormat().format(aString)` does
 * not coerce — it takes ToNumber of it, gets NaN, and throws `RangeError:
 * Invalid time value`. So both of these screens rendered perfectly while a lot
 * had no movements and returned a 500 the instant it had one. Every unit test
 * passed throughout, because they assert on the values in the row and never on
 * the string a page prints from them; the first thing to notice was a driven
 * test, and the first honest thing it said was "This page couldn't load".
 *
 * A bare `pg.Pool` returns real Dates for the same column, which is what makes
 * this worth a comment rather than a one-word fix: probing the database
 * directly says the opposite of what the application sees.
 *
 * Total on purpose. A Date passes through, a string is parsed, and anything
 * else — a null from an outer join that the row type did not admit to —
 * becomes an Invalid Date here rather than an exception inside a render, where
 * React's digest hides which value it was.
 */
export function asDate(value: Date | string | number): Date {
  return value instanceof Date ? value : new Date(value);
}

export function formatMoment(at: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Hong_Kong",
  }).format(at);
}

/** The same moment without the clock, where the hour is warehouse detail. */
export function formatDay(at: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Hong_Kong",
  }).format(at);
}

// ── Reading ─────────────────────────────────────────────────────────────────

/**
 * What one row of the chain query returns.
 *
 * The counts come back as bigints from node-postgres — as text — which is how
 * a count becomes "3"; they are cast in SQL and coerced again on the way out,
 * the same belt and braces src/lib/data/events.ts uses.
 */
// A TYPE ALIAS, NOT AN INTERFACE. `db.execute<T>` constrains T to
// `Record<string, unknown>`, and an interface has no implicit index signature
// — the same reason `StepRow` in src/lib/data/lots.ts is written this way.
type LegRow = {
  id: string;
  occurredAt: Date;
  fromPlace: string | null;
  toPlace: string;
  custodian: string | null;
  reason: string | null;
  note: string | null;
  isPublic: boolean;
  movedWith: number;
  reports: number;
};

/**
 * One lot's chain, NEWEST FIRST.
 *
 * The table and column names are spelled out rather than interpolated from the
 * drizzle schema, for the defect documented at length in src/lib/data/events.ts:
 * drizzle renders an interpolated column UNQUALIFIED inside a `sql` template,
 * which resolves against the wrong table inside a correlated subquery and
 * returns zero for every count with nothing erroring.
 *
 * `is not distinct from` rather than `=` on the origin, because a crate's first
 * packing and an arrival both have a NULL `from_place` and `null = null` is not
 * true — without it, every gesture that starts from nowhere would report a
 * `movedWith` of one however many lots were packed together.
 *
 * The order is TOTAL: two legs can share an instant — a correction written in
 * the same second as the leg it corrects — and a tie left to Postgres can come
 * back either way between two reads of the same lot, which would move the
 * derived location with nobody having changed anything.
 */
export async function listMovements(
  orgId: string,
  lotId: string,
): Promise<MovementLeg[]> {
  const db = getDb();
  const result = await db.execute<LegRow>(sql`
    select
      movements.id                       as id,
      movements.occurred_at              as "occurredAt",
      movements.from_place               as "fromPlace",
      movements.to_place                 as "toPlace",
      movements.custodian                as custodian,
      movements.reason                   as reason,
      movements.note                     as note,
      movements.is_public                as "isPublic",
      (
        select count(*)::int from movements as together
        where together.org_id = movements.org_id
          and together.occurred_at = movements.occurred_at
          and together.to_place = movements.to_place
          and together.from_place is not distinct from movements.from_place
      )                                  as "movedWith",
      (
        select count(*)::int from examinations
        where examinations.movement_id = movements.id
      )                                  as reports
    from movements
    -- Both, always — an id alone is not an authorisation.
    where movements.org_id = ${orgId} and movements.lot_id = ${lotId}
    order by movements.occurred_at desc, movements.created_at desc, movements.id desc
  `);
  return result.rows.map((r) => ({
    ...r,
    occurredAt: asDate(r.occurredAt),
    movedWith: Number(r.movedWith),
    reports: Number(r.reports),
  }));
}

/** What the register shows per lot, before the "alongside" count is joined on. */
type LastRow = {
  lotId: string;
  place: string;
  custodian: string | null;
  since: Date;
};

/**
 * Where every lot of one sale is, in ONE query.
 *
 * `distinct on (lot_id)` with the chain's own total order, which is the query
 * Postgres answers straight off `movements_lot`. The obvious build — the chain
 * per lot, in a loop — is 128 round trips to learn 128 strings, and it is the
 * shape that makes a register unusable at the size a register is for.
 *
 * Lots with no movement are ABSENT from the map rather than present with a
 * null. "Nowhere recorded" is a real state with a real reading on the screen,
 * and a caller that has to distinguish it from "at nowhere" should have to ask.
 */
export async function whereAreThey(
  orgId: string,
  eventId: string,
): Promise<Map<string, Whereabouts>> {
  const db = getDb();
  const result = await db.execute<LastRow>(sql`
    select distinct on (movements.lot_id)
      movements.lot_id      as "lotId",
      movements.to_place    as place,
      movements.custodian   as custodian,
      movements.occurred_at as since
    from movements
    join lots on lots.id = movements.lot_id
    -- Both, always: the org scopes the rows and the event scopes the sale.
    where movements.org_id = ${orgId} and lots.event_id = ${eventId}
    order by movements.lot_id, movements.occurred_at desc, movements.created_at desc, movements.id desc
  `);

  // `alongside` is counted in JS over the rows already in hand rather than as a
  // window function: the register is about ONE sale, so "how many are here" is
  // a question about this map, and asking the database would have counted every
  // lot in the org standing in that place — a different and more surprising
  // number to read beside a sale's own row.
  const here = new Map<string, number>();
  for (const row of result.rows) here.set(row.place, (here.get(row.place) ?? 0) + 1);

  const out = new Map<string, Whereabouts>();
  for (const row of result.rows) {
    out.set(row.lotId, {
      place: row.place,
      custodian: row.custodian,
      since: asDate(row.since),
      alongside: (here.get(row.place) ?? 1) - 1,
    });
  }
  return out;
}

/** A place, and what is standing in it. A crate is one of these. */
export interface PlaceInUse {
  place: string;
  lots: number;
}

/**
 * Every place this org currently has something in, biggest first.
 *
 * DERIVED FROM THE LAST MOVEMENT OF EACH LOT, which is what makes a crate's
 * contents a query rather than a membership set — and what makes the answer
 * correct after a lot is taken out of the crate by hand.
 *
 * Also what the movement form offers as suggestions: the places a house has
 * actually used are a better list than any vocabulary this system could ship,
 * and they cost nothing because the register already needs the query.
 */
export async function placesInUse(orgId: string): Promise<PlaceInUse[]> {
  const db = getDb();
  const result = await db.execute<{ place: string; lots: number }>(sql`
    select place, count(*)::int as lots
    from (
      select distinct on (movements.lot_id)
        movements.lot_id,
        movements.to_place as place
      from movements
      where movements.org_id = ${orgId}
      order by movements.lot_id, movements.occurred_at desc, movements.created_at desc, movements.id desc
    ) as standing
    group by place
    order by count(*) desc, place asc
  `);
  return result.rows.map((r) => ({ place: r.place, lots: Number(r.lots) }));
}

// ── Writing ─────────────────────────────────────────────────────────────────

/** What a person says when they log a move. Every field but the destination is optional. */
export interface MovementInput {
  toPlace: string;
  /**
   * Where it came from. UNDEFINED MEANS "FROM WHEREVER IT IS", which the writer
   * resolves from the chain — a registrar logging a move does not retype the
   * origin, and a form that asked them to would be asking them to copy a value
   * the system already derived. An explicit null is an arrival from outside.
   */
  fromPlace?: string | null;
  occurredAt?: Date;
  custodian?: string | null;
  reason?: string | null;
  note?: string | null;
  isPublic?: boolean;
}

const trimmed = (value: string | null | undefined, max: number): string | null => {
  const text = value?.trim() ?? "";
  return text === "" ? null : text.slice(0, max);
};

/**
 * Move lots. ONE GESTURE, ONE STATEMENT, ONE INSTANT.
 *
 * ── WHY THE PLURAL IS THE ONLY WRITER ───────────────────────────────────────
 *
 * Forty lots move as one gesture, and the thing that makes them one gesture is
 * that they share an `occurred_at` to the microsecond — that is what `movedWith`
 * counts back out, and it is why there is no batch id to store. A loop over a
 * singular writer would give each lot its own `now()`, and the crate would come
 * apart into forty unrelated legs the moment anybody looked at it. A single
 * multi-row insert is also atomic by construction, which is the same reason
 * `insertLots` is one statement: half a crate recorded, with no way to tell
 * which half, is the failure mode worth designing out.
 *
 * ── THE ORIGIN IS RESOLVED PER LOT, FROM THE CHAIN ──────────────────────────
 *
 * Forty lots leaving one crate all came from that crate, so one `from_place`
 * would do — but forty lots being packed INTO a crate came from wherever each
 * of them was standing, and a single origin would write a fact that is false
 * for most of them. So the origin defaults per lot to its own last `to_place`,
 * in the same statement, and a caller that means something else says so.
 *
 * Returns how many rows were written. Lots that are not this org's, or not in
 * the named event, are silently not moved: three ids arrive from a request and
 * an id is not an authorisation.
 */
export async function logMovements(
  orgId: string,
  eventId: string,
  lotIds: readonly string[],
  input: MovementInput,
  decidedBy: string,
): Promise<number> {
  const toPlace = trimmed(input.toPlace, MAX_PLACE);
  if (!toPlace || lotIds.length === 0) return 0;

  const db = getDb();
  // ONE INSTANT for the whole gesture, taken here rather than by `now()` per
  // row: `now()` is the transaction's clock and would in fact agree, but this
  // says it in the one place a reader looks for it, and it survives the day
  // this is called from something that is not one transaction.
  const occurredAt = input.occurredAt ?? new Date();
  const ids = [...new Set(lotIds)];
  const explicitFrom = input.fromPlace === undefined ? null : trimmed(input.fromPlace, MAX_PLACE);
  const useChain = input.fromPlace === undefined;

  const result = await db.execute<{ id: string }>(sql`
    insert into movements
      (org_id, lot_id, occurred_at, from_place, to_place, custodian, reason, note, is_public, decided_by)
    select
      ${orgId},
      lots.id,
      ${occurredAt},
      case when ${useChain} then (
        -- Where this lot is standing now, read in the same statement that moves
        -- it, so nothing between the read and the write can change it.
        select standing.to_place from movements as standing
        where standing.org_id = ${orgId} and standing.lot_id = lots.id
        order by standing.occurred_at desc, standing.created_at desc, standing.id desc
        limit 1
      ) else ${explicitFrom} end,
      ${toPlace},
      ${trimmed(input.custodian, MAX_PLACE)},
      ${trimmed(input.reason, MAX_PLACE)},
      ${trimmed(input.note, MAX_NOTE)},
      ${input.isPublic === true},
      ${decidedBy}
    from lots
    -- Both, always. The event as well as the org, because a movement logged
    -- against another sale's lot is a row this screen could never reach again.
    where lots.org_id = ${orgId}
      and lots.event_id = ${eventId}
      and lots.id = any(${sql.param(ids)}::uuid[])
    returning movements.id as id
  `);
  return result.rows.length;
}

/**
 * Change what a leg SAYS, without changing what it says happened.
 *
 * ── THE ONE FIELD THIS TOUCHES, AND WHY THE REST ARE UNTOUCHABLE ────────────
 *
 * `is_public` is a decision about the CATALOGUE, not about custody: the leg
 * happened either way, and the tick only says whether a bidder is told. So it
 * is editable in place, the way an override is, and nothing about the chain
 * moves when it changes.
 *
 * The places, the dates and the custodian are NOT editable, and that is the
 * whole shape of this feature. "It is not at the saleroom" is a new movement
 * (see the header); an edit would rewrite history in a record that exists in
 * order to be argued from, and would do it with no trace that anything had been
 * different. A registrar who logs the wrong destination appends the correction
 * and both readings stay.
 */
export async function setMovementPublic(
  orgId: string,
  movementId: string,
  isPublic: boolean,
  decidedBy: string,
): Promise<boolean> {
  const db = getDb();
  const rows = await db
    .update(movements)
    .set({ isPublic, decidedBy, updatedAt: new Date() })
    .where(and(eq(movements.orgId, orgId), eq(movements.id, movementId)))
    .returning({ id: movements.id });
  return rows.length > 0;
}

/** One leg, scoped, for a writer that needs to check it before referring to it. */
export async function getMovement(
  orgId: string,
  movementId: string,
): Promise<typeof movements.$inferSelect | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(movements)
    .where(and(eq(movements.orgId, orgId), eq(movements.id, movementId)))
    .limit(1);
  return row ?? null;
}

/** How many lots of a sale have ever moved. The register's own headline. */
export async function countMoved(orgId: string, eventId: string): Promise<number> {
  const db = getDb();
  const [row] = await db
    .select({ n: sql<number>`count(distinct movements.lot_id)::int` })
    .from(movements)
    .innerJoin(lots, eq(lots.id, movements.lotId))
    .where(and(eq(movements.orgId, orgId), eq(lots.eventId, eventId)));
  return Number(row?.n ?? 0);
}
