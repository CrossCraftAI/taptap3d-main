import { sql } from "drizzle-orm";

import { getDb } from "@/db";
import { authConfigured } from "@/lib/auth/session";

// Deliberately outside the access gate (see src/middleware.ts) so the platform
// can tell whether the application is alive without holding a credential.
//
// It answers a question a TCP check cannot: the process is up AND it can reach
// its database. The predecessor spent three separate sessions diagnosing 500s on
// every route that turned out to be Postgres having stopped — a symptom that
// reads like a broken deployment and is not one.
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  if (process.env.TAPTAP3D_REQUIRE_AUTH === "true" && !authConfigured())
    return Response.json({ status: "degraded", authentication: "unconfigured" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  const startedAt = Date.now();
  try {
    await getDb().execute(sql`select 1`);
  } catch {
    return Response.json(
      {
        status: "degraded",
        database: "unreachable",
        // Database errors can disclose hosts, users or connection details.
        detail: "Database check failed.",
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
