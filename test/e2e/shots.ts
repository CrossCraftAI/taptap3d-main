// Where a screenshot lands, named by the engine that took it.
//
// ── WHY THIS IS NOT A TIDY-UP ────────────────────────────────────────────────
//
// Eight spec files each declared the same three lines — one fixed directory,
// one `shot(name)` that joined a bare name onto it — and that was correct for
// as long as there was one project. Adding the webkit project to
// playwright.config.ts made every one of those paths a collision. A two-project
// run writes Chromium's pictures and then writes WebKit's over the top of them,
// under the same names, and nothing on disk records which engine produced the
// file anybody later opens.
//
// That is worse here than in most suites, because the screenshots ARE the
// deliverable: the standing instruction on this project is that a change is not
// verified until somebody has read one. A picture of WebKit's print stylesheet
// filed as "what the printer sees" is a wrong answer delivered confidently,
// which is the failure mode the whole verification discipline exists to avoid.
//
// ── CHROMIUM KEEPS THE BARE DIRECTORY ────────────────────────────────────────
//
// Not because it is the important engine, but because every document, review
// and link that already points at test/e2e/screens/NN-name.png means the
// Chromium one. Suffixing both would break those quietly to gain symmetry.
//
// The directory is made on first use rather than at import: `test.info()` is
// only available inside a running test, so the project name is not knowable at
// module scope — which is precisely why the old arrangement could not have
// carried the name in the first place.

import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { test } from "@playwright/test";

const ROOT = join("test", "e2e", "screens");
const made = new Set<string>();

/** The path for one screenshot, under this project's own directory. */
export function shot(name: string): string {
  const project = test.info().project.name;
  const dir = project === "chromium" ? ROOT : `${ROOT}-${project}`;
  if (!made.has(dir)) {
    mkdirSync(dir, { recursive: true });
    made.add(dir);
  }
  return join(dir, `${name}.png`);
}
