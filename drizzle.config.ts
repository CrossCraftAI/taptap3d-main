import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    // Only read when a command actually talks to the database. `generate` does
    // not, which is why a missing URL must not throw at module load.
    url: process.env.DATABASE_URL ?? "",
  },
  strict: true,
  verbose: true,
});
