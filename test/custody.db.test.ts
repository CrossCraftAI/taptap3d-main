// Custody and condition, against a real Postgres.
//
// The pure halves are held next door (test/movement.test.ts,
// test/condition.test.ts). What can only be proved here is everything that is
// a claim about the DATABASE: that forty lots moving as one gesture really do
// share an instant, that a crate's contents come back from a query rather than
// from a set somebody has to maintain, that one house cannot write into
// another's chain by guessing a uuid, and that the writers refuse the ids they
// are supposed to refuse.
//
// Needs a database and says so by failing — see test/schema.db.test.ts on why
// a suite that self-skips is worse than one that goes red.

import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  assets,
  examinationAssets,
  examinations,
  getDb,
  getPool,
  marks,
  movements,
  orgs,
  users,
} from "@/db";
import { currentActorId, gateEmail } from "@/lib/data/actor";
import { createEvent } from "@/lib/data/events";
import {
  addMark,
  conditionOf,
  createExamination,
  deleteMark,
  examinationInLot,
  listExaminations,
  markInLot,
  setMarkNote,
  setReferenceView,
  updateExamination,
} from "@/lib/data/examinations";
import { insertLots, listLots } from "@/lib/data/lots";
import {
  countMoved,
  formatMoment,
  listMovements,
  logMovements,
  placesInUse,
  setMovementPublic,
  whereAreThey,
  whereItIs,
} from "@/lib/data/movements";

const db = getDb();
let orgA: string;
let orgB: string;
let slugA: string;
let slugB: string;
let eventA: string;
let eventB: string;
let lotIds: string[];
let lotB: string;
let actorA: string;

async function makeOrg(label: string): Promise<{ id: string; slug: string }> {
  const slug = `${label}-${randomUUID().slice(0, 8)}`;
  const [row] = await db
    .insert(orgs)
    .values({ name: label, slug })
    .returning({ id: orgs.id });
  return { id: row!.id, slug };
}

beforeAll(async () => {
  const a = await makeOrg("custody-a");
  const b = await makeOrg("custody-b");
  orgA = a.id;
  slugA = a.slug;
  orgB = b.id;
  slugB = b.slug;

  eventA = (await createEvent(orgA, { name: "Custody Sale" })).id;
  await insertLots(
    orgA,
    eventA,
    Array.from({ length: 5 }, (_, i) => ({
      ref: `K0${i + 1}`,
      fields: { ref: `K0${i + 1}`, title: `拍品 ${i + 1}` },
      sourceRow: i + 1,
    })),
  );
  lotIds = (await listLots(orgA, eventA)).map((l) => l.id);

  eventB = (await createEvent(orgB, { name: "Other House" })).id;
  await insertLots(orgB, eventB, [
    { ref: "X01", fields: { ref: "X01", title: "另一件" }, sourceRow: 1 },
  ]);
  lotB = (await listLots(orgB, eventB))[0]!.id;

  actorA = await currentActorId(orgA);
});

afterAll(async () => {
  await db.delete(orgs).where(eq(orgs.id, orgA));
  await db.delete(orgs).where(eq(orgs.id, orgB));
  // Users are global and do not cascade from an org; the gate identities this
  // run made are removed by hand so a thousand runs do not leave a thousand.
  await db.delete(users).where(eq(users.email, gateEmail(slugA)));
  await db.delete(users).where(eq(users.email, gateEmail(slugB)));
  await getPool().end();
});

// ── The chain ───────────────────────────────────────────────────────────────

describe("a movement is appended and never edited", () => {
  it("writes a first leg with no origin, because it came from outside", async () => {
    const n = await logMovements(
      orgA,
      eventA,
      [lotIds[0]!],
      {
        toPlace: "Photography studio",
        fromPlace: "Lin family collection, Taipei",
        reason: "On receipt from consignor",
        custodian: "L. Cheung",
        isPublic: true,
      },
      actorA,
    );
    expect(n).toBe(1);
    const chain = await listMovements(orgA, lotIds[0]!);
    expect(chain).toHaveLength(1);
    expect(chain[0]!.toPlace).toBe("Photography studio");
    expect(chain[0]!.isPublic).toBe(true);

    // A REAL DATE, AND THIS ASSERTION IS NOT PEDANTRY — it is the one that was
    // missing. `db.execute<T>` takes its type parameter on trust: it shapes
    // nothing, so `occurredAt: Date` in the row type is a promise about the
    // caller and not about the driver, and through this one a raw-SQL
    // `timestamptz` arrives as a STRING.
    //
    // `Intl.DateTimeFormat().format()` does not coerce a string — it takes
    // ToNumber of it, gets NaN and throws. So both screens rendered perfectly
    // while a lot had no movements and returned a 500 the instant it had one,
    // with every test in this file green, because they all read the row and
    // none of them formatted it. Asserting the TYPE is what closes that, and
    // it closes it for every column below as well.
    expect(chain[0]!.occurredAt).toBeInstanceOf(Date);
    expect(Number.isNaN(chain[0]!.occurredAt.getTime())).toBe(false);
    // The formatter itself, on the value the page would hand it.
    expect(() => formatMoment(chain[0]!.occurredAt)).not.toThrow();
    // A HUMAN DECIDED THIS, and the row says so. Null in that column means a
    // machine proposed it and nobody confirmed (src/lib/data/actor.ts); a
    // registrar's movement written as null would read as an unconfirmed
    // proposal the day anything starts proposing movements.
    const [row] = await db
      .select({ decidedBy: movements.decidedBy })
      .from(movements)
      .where(eq(movements.id, chain[0]!.id));
    expect(row!.decidedBy).toBe(actorA);
  });

  it("resolves the origin from the chain when the caller does not say", async () => {
    // A registrar logging a move does not retype where the thing is; the
    // writer reads it in the same statement that moves it, so nothing between
    // the read and the write can change it.
    await logMovements(
      orgA,
      eventA,
      [lotIds[0]!],
      { toPlace: "Warehouse, Kwai Chung", reason: "Return after photography" },
      actorA,
    );
    const chain = await listMovements(orgA, lotIds[0]!);
    expect(chain[0]!.fromPlace).toBe("Photography studio");
    expect(whereItIs(chain)?.place).toBe("Warehouse, Kwai Chung");
  });

  it("gives a lot that has never moved no chain and no invented first leg", async () => {
    expect(await listMovements(orgA, lotIds[4]!)).toEqual([]);
    expect(whereItIs([])).toBeNull();
  });

  it("corrects by appending, leaving the leg that was wrong in place", async () => {
    const before = await listMovements(orgA, lotIds[0]!);
    await logMovements(
      orgA,
      eventA,
      [lotIds[0]!],
      { toPlace: "Photography studio", reason: "Correction" },
      actorA,
    );
    const after = await listMovements(orgA, lotIds[0]!);
    expect(after).toHaveLength(before.length + 1);
    expect(whereItIs(after)?.place).toBe("Photography studio");
    // Every earlier leg is still there, unchanged.
    expect(after.slice(1).map((leg) => leg.id)).toEqual(before.map((leg) => leg.id));
  });
});

describe("a crate is a place, so forty lots move as one gesture", () => {
  const crate = "Crate HK-114";

  it("packs three lots into it in one statement, sharing one instant", async () => {
    const three = lotIds.slice(1, 4);
    const n = await logMovements(
      orgA,
      eventA,
      three,
      { toPlace: crate, reason: "Packed for the saleroom", custodian: "K. Ng" },
      actorA,
    );
    expect(n).toBe(3);
    // THE INSTANT IS WHAT MAKES IT ONE GESTURE. There is no batch column; the
    // count comes back from the movements that share an instant, an origin and
    // a destination.
    for (const lot of three) {
      const chain = await listMovements(orgA, lot);
      expect(chain[0]!.toPlace).toBe(crate);
      expect(chain[0]!.movedWith).toBe(3);
    }
  });

  it("answers what is in the crate from the chain, not from a membership set", async () => {
    const standing = await whereAreThey(orgA, eventA);
    const inside = [...standing.entries()].filter(([, w]) => w.place === crate);
    expect(inside).toHaveLength(3);
    expect(inside[0]![1].alongside).toBe(2);
    expect((await placesInUse(orgA)).find((p) => p.place === crate)?.lots).toBe(3);
  });

  it("empties itself when one lot is taken out by hand", async () => {
    await logMovements(
      orgA,
      eventA,
      [lotIds[1]!],
      { toPlace: "Conservation bench", reason: "Pulled for a closer look" },
      actorA,
    );
    const standing = await whereAreThey(orgA, eventA);
    expect([...standing.values()].filter((w) => w.place === crate)).toHaveLength(2);
    // And nothing anywhere had to be told: there was no membership row to
    // forget to delete.
    expect(standing.get(lotIds[1]!)?.place).toBe("Conservation bench");
  });

  it("moves the whole crate in one gesture and leaves it empty", async () => {
    const standing = await whereAreThey(orgA, eventA);
    const inCrate = [...standing.entries()]
      .filter(([, w]) => w.place === crate)
      .map(([lot]) => lot);
    const n = await logMovements(
      orgA,
      eventA,
      inCrate,
      { toPlace: "Saleroom, Wong Chuk Hang", reason: "Pre-sale viewing" },
      actorA,
    );
    expect(n).toBe(2);
    const after = await whereAreThey(orgA, eventA);
    expect([...after.values()].filter((w) => w.place === crate)).toHaveLength(0);
    // The legs record where they came from, which is the crate.
    const chain = await listMovements(orgA, inCrate[0]!);
    expect(chain[0]!.fromPlace).toBe(crate);
    expect(chain[0]!.movedWith).toBe(2);
  });

  it("counts an unmoved lot as absent rather than as nowhere", async () => {
    const standing = await whereAreThey(orgA, eventA);
    expect(standing.has(lotIds[4]!)).toBe(false);
    expect(await countMoved(orgA, eventA)).toBe(4);
  });
});

describe("one house cannot reach another's chain", () => {
  it("refuses to move a lot that is not in the named event", async () => {
    expect(await logMovements(orgA, eventA, [lotB], { toPlace: "Anywhere" }, actorA)).toBe(0);
    expect(await listMovements(orgA, lotB)).toEqual([]);
    expect(await listMovements(orgB, lotB)).toEqual([]);
  });

  it("refuses to move another org's lot even with that org's event id", async () => {
    expect(await logMovements(orgA, eventB, [lotB], { toPlace: "Anywhere" }, actorA)).toBe(0);
  });

  it("does not show one org's places to another", async () => {
    await logMovements(orgB, eventB, [lotB], { toPlace: "Their warehouse" }, await currentActorId(orgB));
    expect((await placesInUse(orgA)).map((p) => p.place)).not.toContain("Their warehouse");
    expect((await placesInUse(orgB)).map((p) => p.place)).toEqual(["Their warehouse"]);
  });

  it("will not flip another org's provenance tick", async () => {
    const [theirs] = await db
      .select({ id: movements.id })
      .from(movements)
      .where(eq(movements.lotId, lotB))
      .limit(1);
    expect(await setMovementPublic(orgA, theirs!.id, true, actorA)).toBe(false);
    const [after] = await db
      .select({ isPublic: movements.isPublic })
      .from(movements)
      .where(eq(movements.id, theirs!.id));
    expect(after!.isPublic).toBe(false);
  });
});

describe("the one editable thing on a leg is whether it prints", () => {
  it("flips and flips back, and is remembered", async () => {
    const chain = await listMovements(orgA, lotIds[0]!);
    const leg = chain.at(-1)!;
    expect(await setMovementPublic(orgA, leg.id, false, actorA)).toBe(true);
    expect((await listMovements(orgA, lotIds[0]!)).at(-1)!.isPublic).toBe(false);
    expect(await setMovementPublic(orgA, leg.id, true, actorA)).toBe(true);
    expect((await listMovements(orgA, lotIds[0]!)).at(-1)!.isPublic).toBe(true);
  });
});

// ── Condition ───────────────────────────────────────────────────────────────

describe("an examination is filed on a handoff, or on nothing", () => {
  let standing: string;
  let onHandoff: string;
  let leg: string;

  it("files a standing check with no movement at all", async () => {
    const id = await createExamination(
      orgA,
      eventA,
      lotIds[0]!,
      { examiner: "L. Cheung", light: "Daylight · raking · UV", summary: "Good for its age." },
      actorA,
    );
    expect(id).not.toBeNull();
    standing = id!;
    const history = await listExaminations(orgA, lotIds[0]!);
    expect(history).toHaveLength(1);
    expect(history[0]!.movementId).toBeNull();
  });

  it("files one against a leg of this lot's own chain", async () => {
    leg = (await listMovements(orgA, lotIds[0]!))[0]!.id;
    const id = await createExamination(
      orgA,
      eventA,
      lotIds[0]!,
      { movementId: leg, examiner: "K. Ng" },
      actorA,
    );
    expect(id).not.toBeNull();
    onHandoff = id!;
    // And the chain can now count it, which is what paints "no report".
    expect((await listMovements(orgA, lotIds[0]!))[0]!.reports).toBe(1);
  });

  it("refuses a handoff from another lot's chain", async () => {
    const otherLeg = (await listMovements(orgA, lotIds[2]!))[0]!.id;
    expect(
      await createExamination(orgA, eventA, lotIds[0]!, { movementId: otherLeg }, actorA),
    ).toBeNull();
  });

  it("refuses a lot that is not in the named event", async () => {
    expect(await createExamination(orgA, eventA, lotB, {}, actorA)).toBeNull();
  });

  it("comes back oldest first, which is the order a lifetime is built in", async () => {
    const history = await listExaminations(orgA, lotIds[0]!);
    expect(history.map((e) => e.id)).toEqual([standing, onHandoff]);
  });

  it("knows which examinations are this lot's", async () => {
    expect(await examinationInLot(orgA, lotIds[0]!, standing)).toBe(true);
    expect(await examinationInLot(orgA, lotIds[1]!, standing)).toBe(false);
    expect(await examinationInLot(orgB, lotIds[0]!, standing)).toBe(false);
  });

  it("changes what it says without touching its marks", async () => {
    await addMark(orgA, standing, { view: "front", x: 0.5, y: 0.02, note: "Rim nick." });
    expect(
      await updateExamination(orgA, standing, { examiner: "L. Cheung, Registrar" }, actorA),
    ).toBe(true);
    const history = await listExaminations(orgA, lotIds[0]!);
    const it_ = history.find((e) => e.id === standing)!;
    expect(it_.examiner).toBe("L. Cheung, Registrar");
    expect(it_.marks).toHaveLength(1);
  });
});

describe("a mark is a point in a view, with prose and nothing else", () => {
  let examinationId: string;

  beforeAll(async () => {
    examinationId = (await createExamination(orgA, eventA, lotIds[1]!, {}, actorA))!;
  });

  it("clamps a coordinate that landed outside the box rather than refusing it", async () => {
    const id = await addMark(orgA, examinationId, { view: "front", x: 1.4, y: -0.2 });
    expect(id).not.toBeNull();
    const [row] = await db.select().from(marks).where(eq(marks.id, id!));
    expect(row!.x).toBe(1);
    expect(row!.y).toBe(0);
  });

  it("refuses a view this build cannot draw", async () => {
    expect(await addMark(orgA, examinationId, { view: "recto", x: 0.5, y: 0.5 })).toBeNull();
  });

  it("refuses an examination that is not this org's", async () => {
    expect(await addMark(orgB, examinationId, { view: "front", x: 0.5, y: 0.5 })).toBeNull();
  });

  it("numbers by creation order and renumbers on a delete", async () => {
    const first = (await listExaminations(orgA, lotIds[1]!))[0]!.marks;
    const second = await addMark(orgA, examinationId, { view: "front", x: 0.2, y: 0.3 });
    await addMark(orgA, examinationId, { view: "front", x: 0.6, y: 0.9 });
    expect((await listExaminations(orgA, lotIds[1]!))[0]!.marks).toHaveLength(3);

    expect(await deleteMark(orgA, second!)).toBe(true);
    const after = (await listExaminations(orgA, lotIds[1]!))[0]!.marks;
    expect(after).toHaveLength(2);
    // The survivor's identity is unchanged; only its DERIVED number moved,
    // which is the whole reason there is no position column.
    expect(after[0]!.id).toBe(first[0]!.id);
  });

  it("takes prose, and knows whose mark it is", async () => {
    const id = (await listExaminations(orgA, lotIds[1]!))[0]!.marks[0]!.id;
    expect(await markInLot(orgA, lotIds[1]!, id)).toBe(true);
    expect(await markInLot(orgA, lotIds[0]!, id)).toBe(false);
    expect(await setMarkNote(orgA, id, "A 4 mm surface scuff, not present on receipt.")).toBe(true);
    expect((await listExaminations(orgA, lotIds[1]!))[0]!.marks[0]!.note).toBe(
      "A 4 mm surface scuff, not present on receipt.",
    );
    // And another org cannot write it.
    expect(await setMarkNote(orgB, id, "theirs")).toBe(false);
    expect(await deleteMark(orgB, id)).toBe(false);
  });
});

describe("a reference view is one photograph, and it can be taken back", () => {
  let examinationId: string;
  let assetId: string;

  beforeAll(async () => {
    examinationId = (await createExamination(orgA, eventA, lotIds[2]!, {}, actorA))!;
    const [row] = await db
      .insert(assets)
      .values({
        orgId: orgA,
        contentHash: randomUUID().replaceAll("-", ""),
        mimeType: "image/tiff",
        byteSize: 42,
        originalName: "IMG_4413.tif",
      })
      .returning({ id: assets.id });
    assetId = row!.id;
  });

  it("says which photograph a view shows", async () => {
    expect(await setReferenceView(orgA, examinationId, "front", assetId)).toBe(true);
    const [row] = await db
      .select({ hash: assets.contentHash })
      .from(examinationAssets)
      .innerJoin(assets, eq(assets.id, examinationAssets.assetId))
      .where(eq(examinationAssets.examinationId, examinationId));
    const history = await listExaminations(orgA, lotIds[2]!);
    expect(history[0]!.views.front).toBe(row!.hash);
  });

  it("replaces rather than accumulating, so a view has one answer", async () => {
    const [second] = await db
      .insert(assets)
      .values({
        orgId: orgA,
        contentHash: randomUUID().replaceAll("-", ""),
        mimeType: "image/tiff",
        byteSize: 43,
      })
      .returning({ id: assets.id });
    expect(await setReferenceView(orgA, examinationId, "front", second!.id)).toBe(true);
    const rows = await db
      .select()
      .from(examinationAssets)
      .where(eq(examinationAssets.examinationId, examinationId));
    expect(rows).toHaveLength(1);
  });

  it("clears without moving a mark, because a mark is a fraction of the view", async () => {
    await addMark(orgA, examinationId, { view: "front", x: 0.37, y: 0.61 });
    expect(await setReferenceView(orgA, examinationId, "front", null)).toBe(true);
    const history = await listExaminations(orgA, lotIds[2]!);
    expect(history[0]!.views.front).toBeUndefined();
    expect(history[0]!.marks[0]!.x).toBe(0.37);
    expect(history[0]!.marks[0]!.y).toBe(0.61);
  });

  it("refuses another org's photograph", async () => {
    const [theirs] = await db
      .insert(assets)
      .values({
        orgId: orgB,
        contentHash: randomUUID().replaceAll("-", ""),
        mimeType: "image/tiff",
        byteSize: 44,
      })
      .returning({ id: assets.id });
    expect(await setReferenceView(orgA, examinationId, "front", theirs!.id)).toBe(false);
  });
});

describe("the register counts what the screens show", () => {
  it("names only the examined lots, with their marks", async () => {
    const state = await conditionOf(orgA, eventA);
    expect(state.has(lotIds[0]!)).toBe(true);
    expect(state.has(lotIds[3]!)).toBe(false);
    expect(state.get(lotIds[0]!)!.examinations).toBe(2);
    expect(state.get(lotIds[1]!)!.marks).toBeGreaterThan(0);
  });

  it("stops at the sale it was asked about", async () => {
    expect(await conditionOf(orgA, eventB)).toEqual(new Map());
    expect((await conditionOf(orgB, eventA)).size).toBe(0);
  });
});

describe("deleting an org takes its custody record with it", () => {
  it("cascades to movements, examinations, marks and view assignments", async () => {
    const gone = await makeOrg("custody-gone");
    const event = await createEvent(gone.id, { name: "Doomed" });
    await insertLots(gone.id, event.id, [
      { ref: "D01", fields: { ref: "D01" }, sourceRow: 1 },
    ]);
    const lot = (await listLots(gone.id, event.id))[0]!.id;
    const actor = await currentActorId(gone.id);
    await logMovements(gone.id, event.id, [lot], { toPlace: "Somewhere" }, actor);
    const examinationId = (await createExamination(gone.id, event.id, lot, {}, actor))!;
    await addMark(gone.id, examinationId, { view: "front", x: 0.5, y: 0.5 });

    await db.delete(orgs).where(eq(orgs.id, gone.id));
    await db.delete(users).where(eq(users.email, gateEmail(gone.slug)));

    expect(await db.select().from(movements).where(eq(movements.lotId, lot))).toEqual([]);
    expect(
      await db.select().from(examinations).where(eq(examinations.id, examinationId)),
    ).toEqual([]);
    expect(
      await db.select().from(marks).where(eq(marks.examinationId, examinationId)),
    ).toEqual([]);
  });

  it("keeps an examination when the handoff it named is removed", async () => {
    // `set null`, not `cascade`: the observation happened whatever the chain
    // now says about the leg, and a report that vanished with a corrected
    // movement would be a record that deletes itself.
    const lot = lotIds[3]!;
    const actor = actorA;
    await logMovements(orgA, eventA, [lot], { toPlace: "Bench" }, actor);
    const leg = (await listMovements(orgA, lot))[0]!.id;
    const id = (await createExamination(orgA, eventA, lot, { movementId: leg }, actor))!;

    await db.delete(movements).where(and(eq(movements.orgId, orgA), eq(movements.id, leg)));
    const history = await listExaminations(orgA, lot);
    expect(history.map((e) => e.id)).toContain(id);
    expect(history.find((e) => e.id === id)!.movementId).toBeNull();
  });
});
