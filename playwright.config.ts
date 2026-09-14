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
      // The export needs a browser. The image ships one; here we lend it the
      // browser Playwright already installed, so the PDF path is exercised
      // locally instead of only in production.
      PUPPETEER_EXECUTABLE_PATH: process.env.PUPPETEER_EXECUTABLE_PATH ?? "",
    },
  },
  use: {
    // THE DEVICE PRESET FIRST, so the lines under it win. It sat in the project
    // below as `use: { ...devices["Desktop Chrome"] }`, and a project's `use`
    // overrides this one — so the preset's 1280×720 at scale 1 quietly replaced
    // the window declared here, and every screenshot this suite has produced
    // was 1280×720 while the comment beside it said 1440. Found when the editor
    // spec measured the page's share of "a 1440×900 window" and got a number
    // that only made sense at 720 tall.
    ...devices["Desktop Chrome"],
    baseURL: `http://127.0.0.1:${PORT}`,
    // 1440 wide so the rail and the content column are both in frame — the
    // screenshots are the deliverable here, not a by-product.
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium" }],
  reporter: [["list"]],
  // ONE WORKER, because these tests drive the real application against one
  // database and one asset store — deliberately, since that is what makes them
  // worth more than the unit suite. Two workers therefore share mutable state:
  // the photographs spec counts how many photographs exist before and after its
  // own upload, and the PDF spec uploads a plate of its own halfway through
  // that count. Both passed alone and failed together, which is the most
  // expensive kind of flake to diagnose and the cheapest to prevent.
  workers: 1,
  // A flake retried into green is a flake shipped. One attempt.
  retries: 0,
  timeout: 60_000,
});
