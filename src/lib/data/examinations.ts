// Condition: what a lot looked like, on a named occasion.
//
// It is a CONDITION REPORT. Not "conditional" — conditional means contingent on
// something, and this document goes to bidders.
//
// ── ONE TABLE FOR THE HANDOFF AND FOR THE LIFETIME ──────────────────────────
//
// `examinations.movement_id` is nullable, and that single decision is what
// makes a per-handoff document and a lifetime history one thing. An examination
// attached to a movement is what travels with the crate — "as received", "as
// dispatched" — and is the document a claim is argued from. One attached to
// nothing is a standing check: a look in the store, a conservator's visit. Two
// tables would make the lifetime view a union of two shapes that every reader
// merges for itself; one table makes it an ordering.
//
// ── THE COORDINATE SPACE IS THE VIEW, AND EACH VIEW IS ITS OWN ──────────────
//
// Front, reverse and base are three spaces, not three layers of one: a footrim
// mark cannot be expressed in the front view's coordinates at all. A mark's
// (x, y) are fractions of its VIEW — never of an image file, never of a page —
// so a re-shoot at a different resolution leaves every mark where it was. The
// same discipline as `OverrideFrame`, and src/db/schema.ts carries the argument
// and the known limit beside the columns.
//
// That stability is not decoration. It is what makes the LIFETIME view a lookup
// rather than a judgement: the same chip examined at receipt and at dispatch
// lands at the same fractions, so "is this the mark we saw in August" is
// answerable by arithmetic. `lifetimeOf` below is that arithmetic, and its
// tolerance is the one number in this file that is a taste rather than a fact —
// it is named, measured against the badge the viewer draws, and the alternative
// it replaces is written down.
//
// ── A MARK'S NUMBER IS DERIVED ──────────────────────────────────────────────
//
// There is no `position` column. A mark is numbered by its place in the order
// its view was marked up (principle 1: keys are never positional) — storing 3
// would make deleting mark 2 a renumbering job, and would make the number a
// thing the screen and the printed report could disagree about.

import { and, asc, eq, sql } from "drizzle-orm";

import {
  assets,
  examinationAssets,
  examinations,
  getDb,
  lots,
  marks,
  movements,
} from "@/db";
// The tolerance lives beside the RING it is measured against
// (src/lib/condition-geometry.ts). That module is pure — no database, no
// React — precisely so this file and the client viewer can both read it, and
// so the relationship between the two numbers is one a test can hold.
import { asDate } from "@/lib/data/movements";
import { MARK_SAME_WITHIN } from "@/lib/condition-geometry";
import type { EngineLot } from "@/lib/engine/derive";
import { asText } from "@/lib/engine/derive";

/**
 * The faces of an object this system knows how to mark up.
 *
 * A SLUG VALIDATED HERE, not a pgEnum. A house photographing scrolls wants
 * recto and verso, and an enum is a migration; a list the application checks is
 * a line. Three, because three is what a registrar photographs for a ceramic,
 * and the fourth arrives with the customer who needs it.
 */
export const REFERENCE_VIEWS = ["front", "reverse", "base"] as const;
export type ReferenceView = (typeof REFERENCE_VIEWS)[number];

export function isReferenceView(value: unknown): value is ReferenceView {
  return typeof value === "string" && (REFERENCE_VIEWS as readonly string[]).includes(value);
}

/** What a view is called in a heading. Short, because it sits on a button. */
export const VIEW_LABEL: Record<ReferenceView, string> = {
  front: "Front",
  reverse: "Reverse",
  base: "Base",
};

export const MAX_NOTE = 4_000;
export const MAX_NAME = 120;

/**
 * One mark: a point in a view, and what the examiner saw there.
 *
 * `note` is FREE PROSE and there is no taxonomy. That was decided, and
 * src/db/schema.ts says why at length: the categories differ by material, and
 * the interesting half of every note is the qualifier a taxonomy discards.
 */
export interface Mark {
  id: string;
  view: ReferenceView;
  x: number;
  y: number;
  note: string;
  at: Date;
}

export interface Examination {
  id: string;
  /** The handoff this was filed on, or null for a standing check. */
  movementId: string | null;
  examiner: string | null;
  light: string | null;
  summary: string | null;
  /**
   * When it was examined.
   *
   * `created_at`, and that is a decision rather than a shortcut: an examination
   * is filed as it is made — the registrar is standing over the object — so the
   * row's own clock is the observation's clock. A separate `examined_at` would
   * be a second date nobody fills in differently, until the day somebody
   * back-dates a report written up that evening. It gets a column then; it is
   * not one now, because a column with no writer is a promise the schema cannot
   * keep.
   */
  at: Date;
  marks: Mark[];
  /** The photograph standing for each view, by content hash. */
  views: Partial<Record<ReferenceView, string>>;
}

// ── Numbering, which is derived ─────────────────────────────────────────────

/** A mark with the number the screen and the report both print beside it. */
export interface NumberedMark extends Mark {
  /** 1-based, its place in the order this view was marked up. */
  number: number;
}

/**
 * The marks of one view, numbered.
 *
 * PURE. The numbering is the one thing about a mark that two readers could
 * disagree about, and it is a question about an array.
 */
export function marksInView(
  all: readonly Mark[],
  view: ReferenceView,
): NumberedMark[] {
  return all
    .filter((mark) => mark.view === view)
    .map((mark, index) => ({ ...mark, number: index + 1 }));
}

/**
 * Every mark of an examination, numbered WITHIN ITS VIEW, in view order.
 *
 * The number restarts per view because the views are separate spaces and the
 * screen shows one at a time: "mark 2" said while the front view is open has to
 * mean the second mark on the front. The printed report therefore names the
 * view beside the number, so "front 2" and "base 2" are distinguishable on
 * paper where there is no switcher to say which is showing.
 */
export function numberedMarks(all: readonly Mark[]): NumberedMark[] {
  return REFERENCE_VIEWS.flatMap((view) => marksInView(all, view));
}

// ── The lifetime view ───────────────────────────────────────────────────────

/** One fault, across every examination that saw it. */
export interface LifetimeMark {
  view: ReferenceView;
  /** 1-based within the view, in the order the faults were FIRST seen. */
  number: number;
  /** Where the earliest sighting put it. Later sightings do not move it. */
  x: number;
  y: number;
  sightings: LifetimeSighting[];
}

export interface LifetimeSighting {
  examinationId: string;
  at: Date;
  examiner: string | null;
  note: string;
  /** True on the sighting that first recorded this fault. */
  first: boolean;
}

/**
 * Every fault of one lot, with its history — the lifetime report.
 *
 * `history` arrives OLDEST FIRST, because a fault's identity belongs to the
 * examination that first recorded it and the numbering follows first sighting.
 *
 * ── WHY PROXIMITY AND NOT AN IDENTITY ───────────────────────────────────────
 *
 * Nothing links a mark in September's examination to the one in August's. The
 * coordinates are the link, and they can be because they are fractions of a
 * stable space — which is the return on the discipline the header describes. A
 * naive implementation would compare every pair; this walks the faults already
 * found, oldest first, so the earliest sighting claims the position and a later
 * one joins it rather than the other way round. That ordering matters: without
 * it, three sightings drifting a percent each would chain into one fault whose
 * position is the newest, and the numbering would change under a reader.
 */
export function lifetimeOf(
  history: readonly Examination[],
  within = MARK_SAME_WITHIN,
): LifetimeMark[] {
  const faults: LifetimeMark[] = [];
  for (const examination of history) {
    for (const mark of examination.marks) {
      const same = faults.find(
        (fault) =>
          fault.view === mark.view &&
          Math.hypot(fault.x - mark.x, fault.y - mark.y) <= within,
      );
      const sighting: LifetimeSighting = {
        examinationId: examination.id,
        at: examination.at,
        examiner: examination.examiner,
        note: mark.note,
        first: !same,
      };
      if (same) same.sightings.push(sighting);
      else {
        faults.push({
          view: mark.view,
          number: 0,
          x: mark.x,
          y: mark.y,
          sightings: [sighting],
        });
      }
    }
  }
  // Numbered per view, in first-sighting order — the same rule `numberedMarks`
  // uses for one examination, so a fault is "front 2" in both views of the
  // report as long as it was the second fault found on the front.
  return REFERENCE_VIEWS.flatMap((view) =>
    faults
      .filter((fault) => fault.view === view)
      .map((fault, index) => ({ ...fault, number: index + 1 })),
  );
}

// ── Reading ─────────────────────────────────────────────────────────────────

/**
 * One lot's examinations, OLDEST FIRST, each with its marks and its views.
 *
 * THREE QUERIES, NOT ONE PER EXAMINATION. A lot with six examinations of five
 * marks apiece is 30 rows; fetched per examination it is thirteen round trips
 * to build one screen. Joined into one statement it would be 30 copies of each
 * examination's summary prose, which is the transfer `lotNeighbours` refuses
 * for the same reason. Three flat reads and a grouping pass is the shape that
 * costs neither.
 */
export async function listExaminations(
  orgId: string,
  lotId: string,
): Promise<Examination[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: examinations.id,
      movementId: examinations.movementId,
      examiner: examinations.examiner,
      light: examinations.light,
      summary: examinations.summary,
      at: examinations.createdAt,
    })
    .from(examinations)
    // Both, always — an id alone is not an authorisation.
    .where(and(eq(examinations.orgId, orgId), eq(examinations.lotId, lotId)))
    // The same TOTAL order the index carries: two examinations filed in one
    // second must not swap places between two reads, or the lifetime view's
    // numbering would move with nobody having changed anything.
    .orderBy(asc(examinations.createdAt), asc(examinations.id));
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  const [markRows, viewRows] = await Promise.all([
    db
      .select({
        id: marks.id,
        examinationId: marks.examinationId,
        view: marks.view,
        x: marks.x,
        y: marks.y,
        note: marks.note,
        at: marks.createdAt,
      })
      .from(marks)
      .where(and(eq(marks.orgId, orgId), inIds(marks.examinationId, ids)))
      .orderBy(asc(marks.createdAt), asc(marks.id)),
    db
      .select({
        examinationId: examinationAssets.examinationId,
        view: examinationAssets.view,
        hash: assets.contentHash,
      })
      .from(examinationAssets)
      .innerJoin(assets, eq(assets.id, examinationAssets.assetId))
      .where(
        and(
          eq(examinationAssets.orgId, orgId),
          inIds(examinationAssets.examinationId, ids),
        ),
      ),
  ]);

  const out = new Map<string, Examination>(
    rows.map((r) => [r.id, { ...r, marks: [], views: {} }]),
  );
  for (const row of markRows) {
    // A view this build does not know — a row written by a later version, or by
    // hand — is SKIPPED rather than shown in a space that does not exist. The
    // row stays; nothing here can destroy it.
    if (!isReferenceView(row.view)) continue;
    out.get(row.examinationId)?.marks.push({
      id: row.id,
      view: row.view,
      x: row.x,
      y: row.y,
      note: row.note,
      at: row.at,
    });
  }
  for (const row of viewRows) {
    if (!isReferenceView(row.view)) continue;
    const examination = out.get(row.examinationId);
    if (examination) examination.views[row.view] = row.hash;
  }
  return [...out.values()];
}

/**
 * `id = any($1::uuid[])`, written out.
 *
 * `sql.param`, not a bare interpolation: drizzle expands a JS array in a
 * template into `($1, $2)` — a list — and Postgres wants one uuid[] value. The
 * same trap `updateLotFields` documents for its text[].
 */
function inIds(column: unknown, ids: readonly string[]) {
  return sql`${column} = any(${sql.param([...ids])}::uuid[])`;
}

/** What the register shows per lot. Counted, never stored. */
export interface ConditionState {
  examinations: number;
  marks: number;
  latestAt: Date;
}

/**
 * Every examined lot of one sale, in one query.
 *
 * Lots with no examination are ABSENT rather than present with zeroes, for the
 * reason `whereAreThey` gives: "not examined" is a real state the register
 * paints differently, and a caller should have to ask for it.
 */
export async function conditionOf(
  orgId: string,
  eventId: string,
): Promise<Map<string, ConditionState>> {
  const db = getDb();
  // The names are spelled out rather than interpolated from the drizzle schema
  // — see src/lib/data/events.ts for the defect that rule exists for.
  const result = await db.execute<{
    lotId: string;
    examinations: number;
    marks: number;
    latestAt: Date;
  }>(sql`
    select
      examinations.lot_id            as "lotId",
      count(*)::int                  as examinations,
      (
        select count(*)::int from marks
        where marks.examination_id in (
          select inner_ex.id from examinations as inner_ex
          where inner_ex.lot_id = examinations.lot_id
        )
      )                              as marks,
      max(examinations.created_at)   as "latestAt"
    from examinations
    join lots on lots.id = examinations.lot_id
    where examinations.org_id = ${orgId} and lots.event_id = ${eventId}
    group by examinations.lot_id
  `);
  return new Map(
    result.rows.map((r) => [
      r.lotId,
      {
        examinations: Number(r.examinations),
        marks: Number(r.marks),
        // A raw-SQL timestamp is a string through this driver; see `asDate` in
        // ./movements.ts for the page that 500'd before this line existed.
        latestAt: asDate(r.latestAt),
      },
    ]),
  );
}

/**
 * Is this examination this lot's, in this org?
 *
 * THREE IDS ARRIVE FROM A REQUEST AND AN ID IS NOT AN AUTHORISATION. The
 * writers below take an examination id straight off a form, and without this
 * one house could add a mark to another's report by guessing a uuid — which is
 * precisely what the predecessor's API allowed everywhere.
 */
export async function examinationInLot(
  orgId: string,
  lotId: string,
  examinationId: string,
): Promise<boolean> {
  const db = getDb();
  const [row] = await db
    .select({ id: examinations.id })
    .from(examinations)
    .where(
      and(
        eq(examinations.orgId, orgId),
        eq(examinations.lotId, lotId),
        eq(examinations.id, examinationId),
      ),
    )
    .limit(1);
  return !!row;
}

/** The same question for a mark, which is one join further out. */
export async function markInLot(
  orgId: string,
  lotId: string,
  markId: string,
): Promise<boolean> {
  const db = getDb();
  const [row] = await db
    .select({ id: marks.id })
    .from(marks)
    .innerJoin(examinations, eq(examinations.id, marks.examinationId))
    .where(
      and(
        eq(marks.orgId, orgId),
        eq(marks.id, markId),
        eq(examinations.lotId, lotId),
      ),
    )
    .limit(1);
  return !!row;
}

// ── Writing ─────────────────────────────────────────────────────────────────

export interface ExaminationInput {
  /** The handoff this is filed on, or null for a standing check. */
  movementId?: string | null;
  examiner?: string | null;
  light?: string | null;
  summary?: string | null;
}

const trimmed = (value: string | null | undefined, max: number): string | null => {
  const text = value?.trim() ?? "";
  return text === "" ? null : text.slice(0, max);
};

/**
 * File an examination. Returns its id, or null when the lot is not this
 * event's — two ids arrive from a request and an id is not an authorisation.
 *
 * `movementId` is trusted only after it is checked against the same org AND the
 * same lot: an examination filed against another lot's handoff would put one
 * client's custody record inside another's report.
 */
export async function createExamination(
  orgId: string,
  eventId: string,
  lotId: string,
  input: ExaminationInput,
  decidedBy: string,
): Promise<string | null> {
  const db = getDb();
  const [lot] = await db
    .select({ id: lots.id })
    .from(lots)
    .where(and(eq(lots.orgId, orgId), eq(lots.id, lotId), eq(lots.eventId, eventId)))
    .limit(1);
  if (!lot) return null;

  let movementId: string | null = null;
  if (input.movementId) {
    const [leg] = await db
      .select({ id: movements.id })
      .from(movements)
      .where(
        and(
          eq(movements.orgId, orgId),
          eq(movements.lotId, lotId),
          eq(movements.id, input.movementId),
        ),
      )
      .limit(1);
    // A handoff that is not this lot's is REFUSED rather than dropped to null.
    // Filing a report against the wrong leg is a wrong document, and silently
    // filing it against no leg would be a second wrong document nobody asked
    // for.
    if (!leg) return null;
    movementId = leg.id;
  }

  const [row] = await db
    .insert(examinations)
    .values({
      orgId,
      lotId,
      movementId,
      examiner: trimmed(input.examiner, MAX_NAME),
      light: trimmed(input.light, MAX_NAME),
      summary: trimmed(input.summary, MAX_NOTE),
      decidedBy,
    })
    .returning({ id: examinations.id });
  return row?.id ?? null;
}

/** Change what an examination SAYS. The marks are their own writers. */
export async function updateExamination(
  orgId: string,
  examinationId: string,
  input: ExaminationInput,
  decidedBy: string,
): Promise<boolean> {
  const db = getDb();
  const rows = await db
    .update(examinations)
    .set({
      examiner: trimmed(input.examiner, MAX_NAME),
      light: trimmed(input.light, MAX_NAME),
      summary: trimmed(input.summary, MAX_NOTE),
      decidedBy,
      updatedAt: new Date(),
    })
    .where(and(eq(examinations.orgId, orgId), eq(examinations.id, examinationId)))
    .returning({ id: examinations.id });
  return rows.length > 0;
}

/**
 * A fraction of the view, bounded to the view.
 *
 * CLAMPED RATHER THAN REFUSED, the same answer `straightenFromValue` gives for
 * a stored angle: a coarse coordinate is still a coordinate, and a mark that
 * refused to be saved because a pointer landed a pixel outside the box is a
 * fault a registrar cannot record. What is refused is a value that is not a
 * number at all, because that is a caller bug rather than a hand.
 */
export function clampFraction(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.min(1, Math.max(0, value));
}

/**
 * Put a mark on a view. Returns its id, or null when the examination is not
 * this org's or the view is not one this build knows.
 */
export async function addMark(
  orgId: string,
  examinationId: string,
  input: { view: string; x: number; y: number; note?: string },
): Promise<string | null> {
  if (!isReferenceView(input.view)) return null;
  const x = clampFraction(input.x);
  const y = clampFraction(input.y);
  if (x === null || y === null) return null;

  const db = getDb();
  const [own] = await db
    .select({ id: examinations.id })
    .from(examinations)
    .where(and(eq(examinations.orgId, orgId), eq(examinations.id, examinationId)))
    .limit(1);
  if (!own) return null;

  const [row] = await db
    .insert(marks)
    .values({
      orgId,
      examinationId,
      view: input.view,
      x,
      y,
      note: (input.note ?? "").slice(0, MAX_NOTE),
    })
    .returning({ id: marks.id });
  return row?.id ?? null;
}

/** What the examiner saw there. Prose, and the only thing a mark carries. */
export async function setMarkNote(
  orgId: string,
  markId: string,
  note: string,
): Promise<boolean> {
  const db = getDb();
  const rows = await db
    .update(marks)
    .set({ note: note.slice(0, MAX_NOTE), updatedAt: new Date() })
    .where(and(eq(marks.orgId, orgId), eq(marks.id, markId)))
    .returning({ id: marks.id });
  return rows.length > 0;
}

/**
 * Remove a mark.
 *
 * A DELETE AND NOT A FLAG. A mark placed by mistake is not an observation; it
 * is a slip of a finger on a touchscreen at a viewing, and the record is more
 * honest without it. This is the one thing in this phase that is destructive,
 * and it is bounded to the mark: an examination is never deleted, because an
 * examination happened.
 */
export async function deleteMark(orgId: string, markId: string): Promise<boolean> {
  const db = getDb();
  const rows = await db
    .delete(marks)
    .where(and(eq(marks.orgId, orgId), eq(marks.id, markId)))
    .returning({ id: marks.id });
  return rows.length > 0;
}

/**
 * Say which photograph IS a view.
 *
 * The asset must already be this org's — content is org-scoped even though the
 * bytes are content-addressed (src/db/schema.ts on `assets`) — and one view
 * takes one photograph, so this upserts on the unique index rather than
 * accumulating rows the reader would have to choose between.
 *
 * An empty `assetId` CLEARS the view, which is how a registrar takes back a
 * wrong choice. Principle 9: an automatic or human value the person cannot
 * reach is a defect.
 */
export async function setReferenceView(
  orgId: string,
  examinationId: string,
  view: string,
  assetId: string | null,
): Promise<boolean> {
  if (!isReferenceView(view)) return false;
  const db = getDb();
  const [own] = await db
    .select({ id: examinations.id })
    .from(examinations)
    .where(and(eq(examinations.orgId, orgId), eq(examinations.id, examinationId)))
    .limit(1);
  if (!own) return false;

  if (!assetId) {
    const gone = await db
      .delete(examinationAssets)
      .where(
        and(
          eq(examinationAssets.orgId, orgId),
          eq(examinationAssets.examinationId, examinationId),
          eq(examinationAssets.view, view),
        ),
      )
      .returning({ id: examinationAssets.id });
    return gone.length > 0;
  }

  const [asset] = await db
    .select({ id: assets.id })
    .from(assets)
    .where(and(eq(assets.orgId, orgId), eq(assets.id, assetId)))
    .limit(1);
  if (!asset) return false;

  await db
    .insert(examinationAssets)
    .values({ orgId, examinationId, assetId, view })
    .onConflictDoUpdate({
      target: [examinationAssets.examinationId, examinationAssets.view],
      set: { assetId, updatedAt: new Date() },
    });
  return true;
}

// ── What the one renderer prints ────────────────────────────────────────────

/**
 * A condition report, as an `EngineLot` the one renderer can paint.
 *
 * ── WHY THIS IS A TEMPLATE AND NOT A SCREEN THAT PRINTS ─────────────────────
 *
 * ARCHITECTURE.md principle 6: one renderer behind every output. A report
 * painted by a second function would be a second renderer by another name, and
 * the predecessor's preview stopped resembling its deliverable exactly that
 * way. So the report is a DECLARATION (src/lib/engine/templates.ts,
 * CONDITION_REPORT) over a record, and this composes the record.
 *
 * ── THE RECORD IS COMPOSED, NOT STORED ──────────────────────────────────────
 *
 * `EngineLot.fields` is normally `lots.fields`. Here it is the lot's own fields
 * plus what the examination says, rebuilt on every render from the tables —
 * principle 2, nothing stored the engine cannot re-derive. Nothing is written
 * anywhere to make a report printable, which is why correcting a mark's note
 * changes the next printing with no second save.
 *
 * The mark keys are `Mark 1`, `Mark 2` … because `labelFor` falls back to the
 * key for anything that is not a core field, so the key IS the printed label.
 * They are string keys rather than "1" and "2" deliberately: an integer-like
 * key is reordered by the language ahead of every string key in the same
 * object, and a printed order that depends on that is an order nobody can read
 * off this function.
 */
export function conditionReportLot(input: {
  lot: { id: string; ref: string | null; fields: Record<string, unknown> };
  examination: Examination;
  /** Where the handoff went, when this report is filed on one. */
  occasion?: string | null;
  /** What the catalogue would print from the public chain. */
  provenance?: string | null;
  /** The whole history, when the report being printed is the lifetime one. */
  lifetime?: readonly LifetimeMark[];
}): EngineLot {
  const { lot, examination } = input;
  const fields: Record<string, unknown> = {
    title: asText(lot.fields.title),
    maker: asText(lot.fields.maker),
    Examined: examination.at.toISOString().slice(0, 10),
  };
  if (examination.examiner) fields.Examiner = examination.examiner;
  if (examination.light) fields.Light = examination.light;
  if (input.occasion) fields.Occasion = input.occasion;
  if (examination.summary) fields.Summary = examination.summary;
  if (input.provenance) fields.Provenance = input.provenance;

  if (input.lifetime) {
    for (const fault of input.lifetime) {
      // Oldest first, so the line reads as a history: what was seen, and when
      // it was last confirmed.
      const history = fault.sightings
        .map((s) => `${s.at.toISOString().slice(0, 10)} — ${s.note || "noted, no description"}`)
        .join("\n");
      fields[`Mark ${VIEW_LABEL[fault.view].toLowerCase()} ${fault.number}`] = history;
    }
  } else {
    for (const mark of numberedMarks(examination.marks)) {
      // THE VIEW IS IN THE LABEL. On screen the switcher says which view is
      // showing; on paper there is no switcher, so "front 2" and "base 2" would
      // otherwise both print as "2".
      fields[`Mark ${VIEW_LABEL[mark.view].toLowerCase()} ${mark.number}`] =
        mark.note || "Noted, no description.";
    }
  }

  return {
    id: lot.id,
    ref: lot.ref,
    fields,
    // The FRONT view's photograph is the report's plate, falling back to
    // whichever view has one: a report with a picture of the object is worth
    // more than one with a blank box, and the front is what a reader expects.
    images: firstView(examination.views),
  };
}

function firstView(views: Partial<Record<ReferenceView, string>>): string[] {
  for (const view of REFERENCE_VIEWS) {
    const hash = views[view];
    if (hash) return [hash];
  }
  return [];
}
