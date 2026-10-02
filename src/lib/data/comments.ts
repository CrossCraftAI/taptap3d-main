// Reading and writing the house's own argument about a catalogue.
//
// ── WHAT A THREAD IS HERE ──────────────────────────────────────────────────
//
// One opening remark about a (lot, field), and its replies. Not a chat room
// and not a per-page annotation layer: a thread is a QUESTION ABOUT A PART,
// so it travels with the part through every repagination, every density and
// every template — which is the whole reason it is keyed the way `overrides`
// is rather than to a point on a page.

import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";

import { getDb, lotComments, lots, users } from "@/db";

// The shape and the limit live in ./comment-value.ts, which the client panel
// imports — this module reaches the database and a client component that
// imported it would drag a Postgres driver into the browser bundle. Every name
// is re-exported here so a server caller still imports one module.
export * from "./comment-value";
import type { CommentAuthor, CommentThread } from "./comment-value";
import { MAX_COMMENT } from "./comment-value";

const authorOf = (row: {
  authorId: string;
  authorName: string | null;
  authorEmail: string;
}): CommentAuthor => ({
  id: row.authorId,
  // THE ADDRESS IS THE FALLBACK AND NOT "Unknown". A person invited by email
  // who has not signed in yet has no name, and a column of "Unknown" beside
  // real remarks is worse than a column of addresses — one of them can be
  // recognised by a colleague.
  name: row.authorName ?? row.authorEmail,
  email: row.authorEmail,
});

/**
 * Every thread in this catalogue, oldest first, with its replies.
 *
 * ── ONE QUERY AND NOT ONE PER THREAD ───────────────────────────────────────
 *
 * The panel draws all of them at once, and a catalogue under review has
 * dozens. A read per thread is the N+1 that makes a review screen feel
 * broken; this reads the flat list and assembles it here, where the cost is
 * a map rather than a round trip.
 *
 * RESOLVED THREADS COME TOO. They are the answer to the person who asks the
 * same question next week, and the panel's own filter decides whether to
 * draw them — a reader that dropped them would make "show resolved" a second
 * query against a different definition of a thread.
 */
export async function listComments(
  orgId: string,
  catalogueId: string,
): Promise<CommentThread[]> {
  const db = getDb();
  const author = users;
  const rows = await db
    .select({
      id: lotComments.id,
      lotId: lotComments.lotId,
      field: lotComments.field,
      parentId: lotComments.parentId,
      body: lotComments.body,
      createdAt: lotComments.createdAt,
      resolvedAt: lotComments.resolvedAt,
      resolvedBy: lotComments.resolvedBy,
      authorId: author.id,
      authorName: author.name,
      authorEmail: author.email,
      ref: lots.ref,
    })
    .from(lotComments)
    .innerJoin(author, eq(author.id, lotComments.authorId))
    .innerJoin(lots, eq(lots.id, lotComments.lotId))
    .where(and(eq(lotComments.orgId, orgId), eq(lotComments.catalogueId, catalogueId)))
    // A TOTAL ORDER. Two remarks can share a `created_at` — a reply typed
    // into a seeded fixture, or two people in the same millisecond — and a
    // tie left to Postgres comes back either way between two reads, which
    // would shuffle a thread under somebody mid-sentence.
    .orderBy(asc(lotComments.createdAt), asc(lotComments.id));

  // ── WHO SETTLED IT, INCLUDING SOMEBODY WHO NEVER WROTE HERE ──────────────
  //
  // The first version read resolvers out of the rows already in hand and
  // showed no name for anybody else — which is the common case, not the edge
  // one: a manager closing somebody else's question has usually written
  // nothing in that catalogue. A thread that says "resolved" and will not say
  // by whom gives up the entire point of recording it.
  //
  // So the few that are missing are fetched together. ONE QUERY FOR THE
  // PANEL, not one per thread: `inArray` over a handful of ids, and only when
  // there are any.
  const known = new Map<string, CommentAuthor>();
  for (const row of rows) known.set(row.authorId, authorOf(row));

  const strangers = [
    ...new Set(
      rows
        .map((row) => row.resolvedBy)
        .filter((id): id is string => id !== null && !known.has(id)),
    ),
  ];
  if (strangers.length > 0) {
    const extra = await db
      .select({ authorId: users.id, authorName: users.name, authorEmail: users.email })
      .from(users)
      .where(inArray(users.id, strangers));
    for (const row of extra) known.set(row.authorId, authorOf(row));
  }

  const threads = new Map<string, CommentThread>();
  const replies: typeof rows = [];
  for (const row of rows) {
    if (row.parentId) {
      replies.push(row);
      continue;
    }
    threads.set(row.id, {
      id: row.id,
      lotId: row.lotId,
      field: row.field,
      ref: row.ref,
      body: row.body,
      author: authorOf(row),
      createdAt: row.createdAt,
      resolvedAt: row.resolvedAt,
      resolvedBy: row.resolvedBy ? (known.get(row.resolvedBy) ?? null) : null,
      replies: [],
    });
  }
  for (const row of replies) {
    // A reply whose parent is not in this catalogue cannot be drawn anywhere
    // and is dropped rather than promoted to a thread of its own — promoting
    // it would invent an opening remark nobody wrote.
    threads.get(row.parentId!)?.replies.push({
      id: row.id,
      body: row.body,
      author: authorOf(row),
      createdAt: row.createdAt,
    });
  }
  return [...threads.values()];
}

/**
 * How many unresolved threads sit on each lot of this catalogue.
 *
 * For the lots list and the plate badges: "is there anything on this one" is
 * the question a person scanning a sale asks, and it must not cost a read per
 * lot. Resolved threads are not counted — a badge that never goes away is a
 * badge people stop seeing.
 */
export async function countOpenComments(
  orgId: string,
  catalogueId: string,
): Promise<Map<string, number>> {
  const db = getDb();
  const rows = await db
    .select({ lotId: lotComments.lotId, n: sql<number>`count(*)::int` })
    .from(lotComments)
    .where(
      and(
        eq(lotComments.orgId, orgId),
        eq(lotComments.catalogueId, catalogueId),
        isNull(lotComments.parentId),
        isNull(lotComments.resolvedAt),
      ),
    )
    .groupBy(lotComments.lotId);
  return new Map(rows.map((row) => [row.lotId, row.n]));
}

export interface NewComment {
  lotId: string;
  /** Null for a remark about the lot rather than one of its fields. */
  field?: string | null;
  body: string;
  /** The thread being replied to, or null to open one. */
  parentId?: string | null;
}

/**
 * Write a remark.
 *
 * ── THE LOT IS CHECKED AGAINST THE CATALOGUE, NOT JUST THE ORG ─────────────
 *
 * An id arrives from a browser, and `(org, lot)` alone would let somebody
 * comment on one sale's lot from another sale's review screen — which is not
 * a leak, but it writes a remark that neither catalogue can draw. The lot has
 * to be IN this catalogue's event.
 *
 * Returns the new comment's id, or null when the write was refused. Null is a
 * refusal and not an error: every reason for it is something a browser can
 * cause by being a moment out of date.
 */
export async function addComment(
  orgId: string,
  catalogueId: string,
  input: NewComment,
  authorId: string,
): Promise<string | null> {
  const body = input.body.trim();
  if (!body) return null;

  const db = getDb();
  // THE LOT, THE CATALOGUE AND THE ORG IN ONE QUESTION. `catalogues.event_id`
  // is what ties a catalogue to its lots, so this is the join that says "this
  // remark is about something this document contains".
  // `.rows`, not destructuring: drizzle's node-postgres `execute` hands back
  // the driver's QueryResult rather than an array. src/lib/data/movements.ts
  // records the sharper version of the same lesson — this wrapper shapes
  // nothing and parses nothing, so what comes back is whatever pg put there.
  const admitted = await db.execute<{ ok: number }>(sql`
    select 1 as ok
      from catalogues c
      join lots l on l.event_id = c.event_id
     where c.id = ${catalogueId}
       and c.org_id = ${orgId}
       and l.id = ${input.lotId}
       and l.org_id = ${orgId}
     limit 1
  `);
  if (admitted.rows.length === 0) return null;

  if (input.parentId) {
    // A REPLY'S PARENT MUST BE A THREAD IN THIS CATALOGUE, and must itself be
    // a thread: replies to replies would make a tree the panel cannot draw
    // and nobody asked for.
    const [parent] = await db
      .select({ id: lotComments.id })
      .from(lotComments)
      .where(
        and(
          eq(lotComments.id, input.parentId),
          eq(lotComments.orgId, orgId),
          eq(lotComments.catalogueId, catalogueId),
          isNull(lotComments.parentId),
        ),
      )
      .limit(1);
    if (!parent) return null;
  }

  const [row] = await db
    .insert(lotComments)
    .values({
      orgId,
      catalogueId,
      lotId: input.lotId,
      // A REPLY INHERITS NOTHING AND CARRIES NO FIELD. The thread is what is
      // about a part; a reply is about the thread, and storing the field
      // twice is two places for it to disagree.
      field: input.parentId ? null : (input.field ?? null),
      parentId: input.parentId ?? null,
      body: body.slice(0, MAX_COMMENT),
      authorId,
    })
    .returning({ id: lotComments.id });
  return row?.id ?? null;
}

/**
 * Mark a thread settled, or unsettle it.
 *
 * NOT A DELETE, and `resolved_by` is recorded for `overrides.decided_by`'s
 * reason: who decided is a fact, and a thread that can be closed by nobody is
 * a thread that gets reopened forever.
 *
 * Returns whether anything changed. A thread already in the asked-for state
 * is `false`, which is honest rather than an error — two people pressing
 * Resolve at once is an ordinary thing.
 */
export async function resolveComment(
  orgId: string,
  catalogueId: string,
  commentId: string,
  resolved: boolean,
  actorId: string,
): Promise<boolean> {
  const db = getDb();
  const changed = await db
    .update(lotComments)
    .set({
      resolvedAt: resolved ? new Date() : null,
      resolvedBy: resolved ? actorId : null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(lotComments.id, commentId),
        eq(lotComments.orgId, orgId),
        eq(lotComments.catalogueId, catalogueId),
        // THREADS ONLY. A reply has no settled state of its own — the
        // question is settled or it is not — and allowing one would put a
        // resolve control on a row the panel has nowhere to draw it.
        isNull(lotComments.parentId),
      ),
    )
    .returning({ id: lotComments.id });
  return changed.length > 0;
}
