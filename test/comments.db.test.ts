// The review layer against a real Postgres.
//
// What is interesting here is not that a remark can be stored — it is the
// four ways a browser a moment out of date can ask for one that must not be
// written, and the ordering a thread has to keep so it does not shuffle under
// somebody mid-sentence.
//
// Needs a database and says so by failing — see test/schema.db.test.ts on why
// there is no skip path anywhere in this suite.

import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getDb, getPool, orgs, users } from "@/db";
import {
  addComment,
  countOpenComments,
  listComments,
  resolveComment,
} from "@/lib/data/comments";
import { ensureCatalogue } from "@/lib/data/catalogues";
import { createEvent } from "@/lib/data/events";
import { insertLots, listLots } from "@/lib/data/lots";

const db = getDb();
let orgA: string;
let orgB: string;
let specialist: string;
let registrar: string;
/** One catalogue with three lots, shared by the reads below. */
let catalogueId: string;
let lotIds: string[];

async function makeOrg(label: string): Promise<string> {
  const [row] = await db
    .insert(orgs)
    .values({ name: label, slug: `${label}-${randomUUID().slice(0, 8)}` })
    .returning({ id: orgs.id });
  return row!.id;
}

async function makeUser(name: string | null): Promise<string> {
  const [row] = await db
    .insert(users)
    .values({ email: `${randomUUID().slice(0, 8)}@house.hk`, name })
    .returning({ id: users.id });
  return row!.id;
}

/** A catalogue of `count` lots in `orgId`. */
async function catalogue(orgId: string, count: number): Promise<{ id: string; lots: string[] }> {
  const event = await createEvent(orgId, { name: `Review ${randomUUID().slice(0, 6)}` });
  await insertLots(
    orgId,
    event.id,
    Array.from({ length: count }, (_, i) => ({
      ref: `C${i + 1}`,
      fields: { title: `拍品 ${i + 1}` },
      sourceRow: i + 2,
    })),
  );
  const row = await ensureCatalogue(orgId, event.id);
  return { id: row.id, lots: (await listLots(orgId, event.id)).map((l) => l.id) };
}

beforeAll(async () => {
  orgA = await makeOrg("rev-a");
  orgB = await makeOrg("rev-b");
  specialist = await makeUser("A Specialist");
  registrar = await makeUser(null);
  const made = await catalogue(orgA, 3);
  catalogueId = made.id;
  lotIds = made.lots;
});

afterAll(async () => {
  await db.delete(orgs).where(eq(orgs.id, orgA));
  await db.delete(orgs).where(eq(orgs.id, orgB));
  await db.delete(users).where(eq(users.id, specialist));
  await db.delete(users).where(eq(users.id, registrar));
  await getPool().end();
});

describe("a remark about a part of a catalogue", () => {
  it("is stored against the lot and the field, and read back with its author", async () => {
    const made = await catalogue(orgA, 2);
    const id = await addComment(
      orgA,
      made.id,
      { lotId: made.lots[0]!, field: "maker", body: "  作者有誤。  " },
      specialist,
    );
    expect(id).not.toBeNull();

    const threads = await listComments(orgA, made.id);
    expect(threads).toHaveLength(1);
    // TRIMMED, because a remark that is only whitespace is not a remark and
    // one with a trailing newline should not render with one.
    expect(threads[0]!.body).toBe("作者有誤。");
    expect(threads[0]!.field).toBe("maker");
    expect(threads[0]!.author.name).toBe("A Specialist");
    // The lot's own reference travels with the thread, so a panel can name
    // what the remark is about without a query per row.
    expect(threads[0]!.ref).toBe("C1");
  });

  it("falls back to the address when nobody has a name yet", async () => {
    // A person invited by email who has not signed in has no name. A column
    // of "Unknown" beside real remarks is worse than a column of addresses:
    // one of them can be recognised by a colleague.
    const made = await catalogue(orgA, 1);
    await addComment(orgA, made.id, { lotId: made.lots[0]!, body: "?" }, registrar);
    const [thread] = await listComments(orgA, made.id);
    expect(thread!.author.name).toContain("@house.hk");
  });

  it("is about the lot itself when no field is named", async () => {
    const made = await catalogue(orgA, 1);
    await addComment(orgA, made.id, { lotId: made.lots[0]!, body: "開場拍品" }, specialist);
    expect((await listComments(orgA, made.id))[0]!.field).toBeNull();
  });

  it("refuses an empty remark rather than storing a blank row", async () => {
    const made = await catalogue(orgA, 1);
    expect(
      await addComment(orgA, made.id, { lotId: made.lots[0]!, body: "   " }, specialist),
    ).toBeNull();
    expect(await listComments(orgA, made.id)).toEqual([]);
  });

  it("refuses a lot that is not in this catalogue", async () => {
    // Not a leak — it would write a remark neither catalogue could draw.
    const mine = await catalogue(orgA, 1);
    const other = await catalogue(orgA, 1);
    expect(
      await addComment(orgA, mine.id, { lotId: other.lots[0]!, body: "x" }, specialist),
    ).toBeNull();
  });

  it("refuses across orgs — an id is not an authorisation", async () => {
    const theirs = await catalogue(orgB, 1);
    expect(
      await addComment(orgA, theirs.id, { lotId: theirs.lots[0]!, body: "x" }, specialist),
    ).toBeNull();
    expect(await listComments(orgB, theirs.id)).toEqual([]);
  });
});

describe("a thread and its replies", () => {
  it("keeps replies under their thread, oldest first", async () => {
    const made = await catalogue(orgA, 1);
    const thread = await addComment(
      orgA,
      made.id,
      { lotId: made.lots[0]!, field: "price", body: "估價偏低？" },
      specialist,
    );
    await addComment(
      orgA,
      made.id,
      { lotId: made.lots[0]!, body: "同意，建議上調。", parentId: thread },
      registrar,
    );
    await addComment(
      orgA,
      made.id,
      { lotId: made.lots[0]!, body: "已與委託人確認。", parentId: thread },
      specialist,
    );

    const threads = await listComments(orgA, made.id);
    // ONE THREAD, NOT THREE ROWS. A reader that returned replies as threads
    // would draw the same conversation three times.
    expect(threads).toHaveLength(1);
    expect(threads[0]!.replies.map((r) => r.body)).toEqual([
      "同意，建議上調。",
      "已與委託人確認。",
    ]);
  });

  it("refuses a reply to a reply, which the panel has nowhere to draw", async () => {
    const made = await catalogue(orgA, 1);
    const thread = await addComment(
      orgA,
      made.id,
      { lotId: made.lots[0]!, body: "一" },
      specialist,
    );
    const reply = await addComment(
      orgA,
      made.id,
      { lotId: made.lots[0]!, body: "二", parentId: thread },
      specialist,
    );
    expect(
      await addComment(orgA, made.id, { lotId: made.lots[0]!, body: "三", parentId: reply }, specialist),
    ).toBeNull();
  });

  it("refuses a reply to a thread in another catalogue", async () => {
    const mine = await catalogue(orgA, 1);
    const other = await catalogue(orgA, 1);
    const elsewhere = await addComment(
      orgA,
      other.id,
      { lotId: other.lots[0]!, body: "x" },
      specialist,
    );
    expect(
      await addComment(
        orgA,
        mine.id,
        { lotId: mine.lots[0]!, body: "y", parentId: elsewhere },
        specialist,
      ),
    ).toBeNull();
  });

  it("gives a reply no field of its own, so there is one place it can disagree", async () => {
    const made = await catalogue(orgA, 1);
    const thread = await addComment(
      orgA,
      made.id,
      { lotId: made.lots[0]!, field: "maker", body: "一" },
      specialist,
    );
    await addComment(
      orgA,
      made.id,
      { lotId: made.lots[0]!, field: "price", body: "二", parentId: thread },
      specialist,
    );
    // The thread is what is about a part; the reply is about the thread.
    expect((await listComments(orgA, made.id))[0]!.field).toBe("maker");
  });
});

describe("settling a thread", () => {
  it("records who settled it, and does not delete it", async () => {
    // "We discussed this and decided no" is the answer to the person who asks
    // again next week.
    const made = await catalogue(orgA, 1);
    const thread = await addComment(
      orgA,
      made.id,
      { lotId: made.lots[0]!, body: "改標題？" },
      specialist,
    );
    expect(await resolveComment(orgA, made.id, thread!, true, registrar)).toBe(true);

    const [after] = await listComments(orgA, made.id);
    expect(after!.resolvedAt).toBeInstanceOf(Date);
    expect(after!.resolvedBy?.id).toBe(registrar);
    expect(after!.body).toBe("改標題？");
  });

  it("can be unsettled, and says so when nothing changed", async () => {
    const made = await catalogue(orgA, 1);
    const thread = await addComment(orgA, made.id, { lotId: made.lots[0]!, body: "?" }, specialist);
    await resolveComment(orgA, made.id, thread!, true, specialist);
    expect(await resolveComment(orgA, made.id, thread!, false, specialist)).toBe(true);
    expect((await listComments(orgA, made.id))[0]!.resolvedAt).toBeNull();
    // A thread nobody can find is `false` rather than an error: two people
    // pressing Resolve at once is an ordinary thing.
    expect(await resolveComment(orgA, made.id, randomUUID(), true, specialist)).toBe(false);
  });

  it("refuses to settle a reply, which has no settled state of its own", async () => {
    const made = await catalogue(orgA, 1);
    const thread = await addComment(orgA, made.id, { lotId: made.lots[0]!, body: "一" }, specialist);
    const reply = await addComment(
      orgA,
      made.id,
      { lotId: made.lots[0]!, body: "二", parentId: thread },
      specialist,
    );
    expect(await resolveComment(orgA, made.id, reply!, true, specialist)).toBe(false);
  });
});

describe("what the sale's list needs to know", () => {
  it("counts open threads per lot, and stops counting a settled one", async () => {
    // A badge that never goes away is a badge people stop seeing.
    const made = await catalogue(orgA, 3);
    const first = await addComment(orgA, made.id, { lotId: made.lots[0]!, body: "一" }, specialist);
    await addComment(orgA, made.id, { lotId: made.lots[0]!, body: "二" }, specialist);
    await addComment(orgA, made.id, { lotId: made.lots[1]!, body: "三" }, specialist);
    // A reply is not a thread and must not be counted twice.
    await addComment(
      orgA,
      made.id,
      { lotId: made.lots[0]!, body: "四", parentId: first },
      specialist,
    );

    let counts = await countOpenComments(orgA, made.id);
    expect(counts.get(made.lots[0]!)).toBe(2);
    expect(counts.get(made.lots[1]!)).toBe(1);
    expect(counts.has(made.lots[2]!)).toBe(false);

    await resolveComment(orgA, made.id, first!, true, specialist);
    counts = await countOpenComments(orgA, made.id);
    expect(counts.get(made.lots[0]!)).toBe(1);
  });

  it("and the shared catalogue reads back nothing it was not given", async () => {
    // The fixture catalogue is untouched by every test above, which is what
    // makes those assertions about their own data rather than about order of
    // execution.
    expect(await listComments(orgA, catalogueId)).toEqual([]);
    expect(lotIds).toHaveLength(3);
  });
});
