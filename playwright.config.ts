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
  //
  // AND IT IS BUILT HERE, which it was not. This read `npm run start` with
  // `reuseExistingServer`, and neither of them builds: whatever `.next` happened
  // to hold was what the suite measured. That is not a theoretical hole — it was
  // found by measuring it. A run against sources dated the 21st exercised a
  // BUILD_ID dated the 14th and failed corrections.spec.ts on a missing lot
  // stepper, which looked exactly like a regression in the component being
  // reviewed and was a week-old bundle that had never contained it. A suite that
  // can fail for that reason can also PASS for it, which is the expensive half.
  //
  // So: build, then start, and no reuse. The costs are real and both are worth
  // paying. A no-change rebuild is a few seconds against a warm .next/cache, and
  // a changed one is the build that had to happen anyway before the number
  // meant anything. A dev server already sitting on this port now fails the run
  // with "already used" instead of silently becoming the thing under test.
  webServer: {
    command: `npm run build && npm run start -- --port ${PORT}`,
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: false,
    // Long enough for a cold `next build` on a machine that has never built
    // this tree, which is the case that matters: the short timeout is only ever
    // comfortable for the developer who did not need it.
    timeout: 300_000,
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
  projects: [
    { name: "chromium" },
    // ARCHITECTURE.md principle 10 — "where a check is cross-cutting, two
    // browser engines among them, run a control and believe it." (Not 8: that
    // one is the CSP rule about the preview frame, which this column happens to
    // carry onto a second engine, but it is not what licenses the column.) The
    // predecessor's entire editing layer was dead in Safari for a year while
    // Chromium-only testing reported everything green; the next phase builds an
    // editing layer. So the second engine arrives before there is anything in it
    // to break, and it runs the same built application against the same
    // database — not a smoke test of its own.
    //
    // IT IS NOT YET A GATE, and calling it one would be the kind of claim this
    // file exists to stop making. .github/workflows/ci.yml runs migrate,
    // typecheck, lint, vitest and build; Playwright is in none of it, chromium
    // included. Putting it there needs a seeded database, the browsers, and CJK
    // fonts on the runner or pdf.spec's paint probe fails for the wrong reason.
    // Until that job exists this is a control a person runs, and `npm run
    // test:e2e` is the whole command.
    //
    // BROWSERNAME IS NOT DECORATION HERE. The top-level `use` spreads
    // `devices["Desktop Chrome"]`, and that preset carries
    // `defaultBrowserType: "chromium"`. A project written as the obvious
    // `{ name: "webkit" }` therefore launches CHROMIUM and reports a green
    // WebKit column — measured rather than assumed: a bare project resolved to
    // `navigator.vendor === "Google Inc."`, and with `browserName` set it is
    // "Apple Computer, Inc.", AppleWebKit 605.1.15. A gate that lies about
    // which engine it ran is worse than no gate at all.
    //
    // The user agent is overridden for the same reason. Nothing in the
    // application reads it today, but the value inherited from the preset
    // actively claims to be Chrome 153 on Windows, so the one run that exists to
    // prove Safari would name the wrong engine in every server log line it
    // produced. It is the UA string alone and not the device preset: spreading
    // `devices["Desktop Safari"]` here would lay a 1280×720 viewport back over
    // the window declared above, which is precisely the bug the note on `use`
    // records.
    //
    // ALL FIFTEEN BUT ONE. The whole suite on WebKit is ~1.5 minutes against a
    // warm server, so cost buys no argument for a curated subset — and this is
    // a denylist rather than a list of blessed files so that a spec written
    // tomorrow is inside the gate by default, which is the only arrangement
    // principle 8 survives. `pdf.spec.ts` is the exception on two grounds. The
    // export is not in this browser: the route launches Chromium through
    // puppeteer server-side, so the bytes, the page count and the CJK header are
    // one artefact whichever engine clicked the link, and the preview-frame
    // assertions it shares are already held by pitch.spec.ts and editor.spec.ts.
    // Worse, its last act screenshots print media as "what the printer sees" —
    // on WebKit that is a picture of WebKit's print stylesheet rather than of
    // the document the PDF is actually made from, and it lands on the same
    // filename as the true one.
    //
    // That collision is general and still unsolved: every spec writes to a fixed
    // path under test/e2e/screens, so after a two-project run every screenshot
    // is WebKit's and nothing on disk says so. The fix is the shot path taking
    // the project name, in eight spec files. Until then, the screenshots are
    // read from a single-project run.
    //
    // WHAT IT CAUGHT ON ITS FIRST RUN, which is the only argument for it that
    // matters: clicking a <button> does not focus it in WebKit, as on macOS, so
    // the rail toggle's promise that focus stays on the one way back was false
    // in Safari and green in Chromium. One line in src/components/shell.tsx.
    //
    // No pass count is recorded here. Principle 10 cuts both ways: a number in
    // a comment is an assertion, it cannot be re-measured by the person reading
    // it, and this column contains at least one known race — `pageRect`
    // evaluates into the preview frame while a fit change is replacing it,
    // which Chromium wins and WebKit loses some of the time. The run report
    // belongs in the commit message, where it is dated.
    {
      name: "webkit",
      testIgnore: ["**/pdf.spec.ts"],
      use: {
        browserName: "webkit",
        userAgent: devices["Desktop Safari"].userAgent,
      },
    },
  ],
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
