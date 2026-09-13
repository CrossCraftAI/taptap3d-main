import { existsSync } from "node:fs";

import { defineConfig, devices } from "@playwright/test";

// Same reason vitest.config.ts does it: the server this starts reads
// DATABASE_URL, and a missing one fails in a way that reads like a broken test.
if (existsSync(".env")) process.loadEnvFile(".env");

const PORT = 3100;

export default defineConfig({
  testDir: "./test/e2e",
  // THE BUILT APPLICATION, not the dev server. `next dev` compiles on demand, so
  // the first visit to every route is slower than any sane timeout and the thing
  // under test is not the thing that ships.
  webServer: {
    command: "npm run start -- --port 3100",
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      // Pinned rather than resolved: `currentOrgId()` refuses when more than one
      // org exists, and a developer's machine frequently has several.
      TAPTAP3D_ORG_SLUG: process.env.TAPTAP3D_ORG_SLUG ?? "dev",
      // The gate is off for the run. It is proved separately and it is not what
      // these tests are measuring.
      GATE_PASSWORD: "",
      TAPTAP3D_ASSET_ROOT: ".data/assets",
    },
  },
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    // 1440 wide so the rail and the content column are both in frame — the
    // screenshots are the deliverable here, not a by-product.
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  reporter: [["list"]],
  // A flake retried into green is a flake shipped. One attempt.
  retries: 0,
  timeout: 60_000,
});
