import { sql } from "drizzle-orm";

import { getDb } from "@/db";

// Deliberately outside the access gate (see src/middleware.ts) so the platform
// can tell whether the application is alive without holding a credential.
//
// It answers a question a TCP check cannot: the process is up AND it can reach
// its database. The predecessor spent three separate sessions diagnosing 500s on
// every route that turned out to be Postgres having stopped — a symptom that
// reads like a broken deployment and is not one.
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const startedAt = Date.now();
  try {
    await getDb().execute(sql`select 1`);
  } catch (error) {
    return Response.json(
      {
        status: "degraded",
        database: "unreachable",
        // The message, not the stack: this endpoint is unauthenticated.
        detail: error instanceof Error ? error.message : "unknown",
      },
      { status: 503 },
    );
  }
  return Response.json({
    status: "ok",
    database: "reachable",
    latencyMs: Date.now() - startedAt,
  });
}
