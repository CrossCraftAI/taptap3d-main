import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    // "node", not "jsdom", and that is a decision rather than a default: the
    // things worth testing here are geometry, schema and data rules, and a DOM
    // shim invites tests that assert a component rendered rather than that the
    // product is correct. Interaction is proved by driving the real application
    // in a real browser — see ARCHITECTURE.md, "Measure, don't assert".
    environment: "node",
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    // A skipped test is a failure unless someone asked for it. The predecessor
    // lost ~121 tests to suites that quietly self-skipped when the database was
    // unreachable, and the headline stayed green.
    passWithNoTests: false,
  },
});
