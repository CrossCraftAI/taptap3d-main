import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema";

export * from "./schema";

/**
 * The pool and the client are both LAZY, and that is deliberate.
 *
 * Nothing here reads the environment or opens a socket at import time, so
 * importing the schema — which the structural tests do — never requires a
 * database. The predecessor's database-backed suites could not run without
 * Postgres and quietly self-skipped when it was absent, removing roughly 121
 * tests while the headline stayed green. Tests that need data should say so by
 * failing, not by vanishing.
 *
 * There is no eagerly-constructed `db` export for the same reason: a module-level
 * `drizzle(pool)` would make every import of this file a connection attempt.
 */
let pool: Pool | undefined;
let client: NodePgDatabase<typeof schema> | undefined;

function connectionString(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env — see README.",
    );
  }
  return url;
}

export function getPool(): Pool {
  pool ??= new Pool({ connectionString: connectionString() });
  return pool;
}

export function getDb(): NodePgDatabase<typeof schema> {
  client ??= drizzle(getPool(), { schema });
  return client;
}

/**
 * Whatever a write can be handed to — the database itself, or a transaction
 * opened by a caller who needs two writes to land together or not at all.
 *
 * Derived from `transaction`'s own callback rather than named, so it cannot
 * drift from the driver: a writer function typed `Writer` accepts both, and a
 * caller that has a `tx` in hand passes it without either side knowing which
 * it is.
 */
export type Writer =
  | NodePgDatabase<typeof schema>
  | Parameters<Parameters<NodePgDatabase<typeof schema>["transaction"]>[0]>[0];
