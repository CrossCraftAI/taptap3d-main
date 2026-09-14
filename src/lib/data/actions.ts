// The instrument's writer.
//
// `action_log` has existed since M0 with nothing writing to it, because the
// measurement it exists for (ROADMAP D9: does a derived start or a blank start
// cost fewer gestures?) cannot be retrofitted — the gestures not counted now are
// gone. The gestures that matter most for that question are the CORRECTION
// gestures, and this lands with the first of those for that reason.
//
// The session and the sequence are the CLIENT'S, as schema.ts says: a session is
// a stretch of work in one tab, not a login, and the client is the only party
// that knows when two gestures were one sitting. The server verifies the org and
// the catalogue and writes what it was told.

import { and, eq, inArray } from "drizzle-orm";

import { actionLog, catalogues, getDb } from "@/db";

export interface ActionEntry {
  seq: number;
  action: string;
  payload?: Record<string, unknown>;
  catalogueId?: string | null;
  occurredAt?: Date;
}

/**
 * Record a batch of gestures from one session.
 *
 * `(session_id, seq)` is unique, and the insert does nothing on conflict: a
 * beacon retried after a dropped connection must not fail and must not count a
 * gesture twice. A catalogue id the org does not own is not written as a foreign
 * key — it is moved into the payload as `catalogueUnknown`, so the gesture is
 * still counted and the mismatch is visible rather than a 500 nobody reads.
 */
export async function recordActions(
  orgId: string,
  sessionId: string,
  userId: string | null,
  entries: ActionEntry[],
): Promise<number> {
  if (entries.length === 0) return 0;
  const db = getDb();

  const claimed = [
    ...new Set(entries.map((e) => e.catalogueId).filter((c): c is string => !!c)),
  ];
  const owned = new Set(
    claimed.length === 0
      ? []
      : (
          await db
            .select({ id: catalogues.id })
            .from(catalogues)
            .where(and(eq(catalogues.orgId, orgId), inArray(catalogues.id, claimed)))
        ).map((r) => r.id),
  );

  const rows = await db
    .insert(actionLog)
    .values(
      entries.map((entry) => {
        const known = entry.catalogueId && owned.has(entry.catalogueId);
        return {
          orgId,
          userId,
          sessionId,
          seq: entry.seq,
          action: entry.action,
          catalogueId: known ? entry.catalogueId! : null,
          payload:
            entry.catalogueId && !known
              ? { ...(entry.payload ?? {}), catalogueUnknown: entry.catalogueId }
              : (entry.payload ?? {}),
          occurredAt: entry.occurredAt ?? new Date(),
        };
      }),
    )
    .onConflictDoNothing({ target: [actionLog.sessionId, actionLog.seq] })
    .returning({ id: actionLog.id });
  return rows.length;
}

/** The gestures recorded against one catalogue, oldest first. For D9, and tests. */
export async function listActions(
  orgId: string,
  catalogueId: string,
): Promise<(typeof actionLog.$inferSelect)[]> {
  const db = getDb();
  return db
    .select()
    .from(actionLog)
    .where(and(eq(actionLog.orgId, orgId), eq(actionLog.catalogueId, catalogueId)))
    .orderBy(actionLog.sessionId, actionLog.seq);
}
