// Apply migrations at boot, using drizzle-orm's migrator rather than
// drizzle-kit.
//
// drizzle-kit is a DEV dependency and is not in the production image — and the
// predecessor learned a sharper version of this lesson: shipping a CLI meant
// shipping `node_modules/.bin/tsx`, whose dereferenced symlink broke the image.
// The migrator is part of drizzle-orm, which the application depends on at
// runtime, so the standalone build already traced it. Plain ESM, no transpiler.

import { readFileSync } from "node:fs";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("migrate: DATABASE_URL is not set");
  process.exit(1);
}

// How many migrations the image expects to apply, read from the journal that
// ships beside them. Printed so a boot log says what it did rather than only
// that it finished.
let expected = "unknown";
try {
  const journal = JSON.parse(
    readFileSync(new URL("./drizzle/meta/_journal.json", import.meta.url), "utf8"),
  );
  expected = String(journal.entries?.length ?? "unknown");
} catch {
  // A missing journal is not fatal here — the migrator will say so more
  // precisely than this guess can.
}

const pool = new pg.Pool({ connectionString: url, max: 1 });
try {
  console.log(`migrate: applying up to ${expected} migration(s)…`);
  await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
  console.log("migrate: done");
} catch (error) {
  // FATAL, deliberately. A container that starts with a schema behind its code
  // fails in a hundred confusing ways downstream; failing here names the cause
  // once.
  console.error("migrate: FAILED —", error instanceof Error ? error.message : error);
  process.exit(1);
} finally {
  await pool.end();
}
