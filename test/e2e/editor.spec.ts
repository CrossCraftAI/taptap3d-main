// The editor takes the window, driven — and the number that says so.
//
// Measured on production before this change, in a 1440×900 window: the A4
// page was 450×637, which is 22.1% of the screen. A 224px rail, a ~130px
// header, a ~60px controls bar and a 340px lots panel had the other 78%. The
// owner's words were that the editor had been "reduced to bare minimum", and
// the page is the entire point of the product.
//
// ARCHITECTURE.md principle 10: measure, don't assert. So this measures the
// same thing after — the page's rect, in the window's own coordinates, as a
// share of the window — and holds it as a floor, with the old number beside
// it. Then it holds what the chrome promises: the rail goes and comes back by
// button and by keyboard, the choice is remembered, the shortcut never takes
// a keystroke meant for a field, focus is never lost into a hidden rail, and
// the lots panel can be put away too.
//
// Runs against the BUILT application and a real database, one worker.

import { expect, test, type FrameLocator, type Locator, type Page } from "@playwright/test";

import { createEvent } from "./sale";
import { shot } from "./shots";

const RUN = Date.now();
const REF = `E${RUN}`;
const ref = (n: number): string => `${REF}-${n}`;

/** The window the number is stated for, and the share the page had in it before. */
const WINDOW = { width: 1440, height: 900 };
// PINNED HERE, not trusted to the config. The config said 1440×900 and drove
// 1280×720 for every screenshot before this: a project-level device preset
// spread over the top-level `use` and quietly replaced the viewport. A
// measurement that does not state its own window is a number about nothing,
// so this file declares it and checks it before measuring.
test.use({ viewport: WINDOW });
const BEFORE = 0.221;
/** Fit-page cannot beat an A4 portrait page the full height of the window: 636×900 = 44%. */
const CEILING = (900 * 210) / 297 / WINDOW.width;

const A4 = 210 / 297;

const toggle = (page: Page): Locator => page.getByRole("button", { name: "Navigation" });
const rail = (page: Page): Locator => page.getByRole("navigation", { name: "Sections" });
const frameOf = (page: Page): FrameLocator =>
  page.frameLocator('iframe[title="Catalogue preview"]');

/**
 * A measurement lost because the thing being measured was replaced mid-read.
 *
 * Every control on this screen commits by bumping the catalogue's `updatedAt`,
 * which bumps `previewKey`, which changes the iframe's `src` — so the document
 * this reads into is torn down and rebuilt on the far side of the very gesture
 * the caller just made. An `evaluate` that started before the swap lands in a
 * context that no longer exists.
 */
const REPLACED = /execution context was destroyed|frame (was )?detached|not attached/i;

/**
 * The first page's rect in WINDOW coordinates: the frame's box plus the page's
 * box inside it.
 *
 * IT RETRIES ITS OWN READ, and the retry is the load-bearing part. Chromium
 * usually finishes the evaluate before the swap and WebKit usually does not,
 * so this arrived looking like an engine difference and is a race both engines
 * have. The caller's `expect.poll` cannot absorb it: poll retries a value it
 * was handed, and this throws instead of handing one over.
 *
 * Only the replacement family is retried, and only for ten seconds. Anything
 * else — a missing frame, a page that never renders — is raised on the first
 * attempt, because a helper that swallows every error for ten seconds turns
 * every real failure in this file into a timeout with the wrong message.
 */
async function pageRect(
  page: Page,
): Promise<{ x: number; y: number; width: number; height: number; share: number }> {
  // Measure the window you think you are measuring.
  expect(page.viewportSize()).toEqual(WINDOW);
  const deadline = Date.now() + 10_000;
  for (;;) {
    try {
      const box = await page.locator('iframe[title="Catalogue preview"]').boundingBox();
      expect(box).not.toBeNull();
      const inner = await frameOf(page)
        .locator(".page")
        .first()
        .evaluate((el) => {
          const r = el.getBoundingClientRect();
          return { x: r.x, y: r.y, width: r.width, height: r.height };
        });
      const rect = {
        x: box!.x + inner.x,
        y: box!.y + inner.y,
        width: inner.width,
        height: inner.height,
      };
      return { ...rect, share: (rect.width * rect.height) / (WINDOW.width * WINDOW.height) };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!REPLACED.test(message) || Date.now() > deadline) throw error;
      await page.waitForTimeout(100);
    }
  }
}

test("a new event lands on a blank page with the tools live, and the rail put away", async ({
  page,
}) => {
  const { eventUrl } = await createEvent(page, `Blank Sale ${RUN}`);

  // ── THE RAIL IS AWAY, and the way back is in the corner ──────────────────
  await expect(toggle(page)).toBeVisible();
  await expect(toggle(page)).toHaveAttribute("aria-expanded", "false");
  await expect(toggle(page)).toHaveAttribute("aria-controls", "rail");
  await expect(rail(page)).toBeHidden();

  // ── A REAL PAGE, not a card about one ────────────────────────────────────
  const frame = frameOf(page);
  await expect(frame.locator(".page--empty")).toHaveCount(1);
  await expect(frame.locator(".slot")).toHaveCount(0);
  await expect(frame.locator(".folio")).toHaveCount(0);
  const blank = await pageRect(page);
  // A4, to within a percent: it is a sheet on the template's geometry, not a
  // box sized by the sentence that used to be in it.
  expect(blank.width / blank.height).toBeCloseTo(A4, 2);
  // Whole, and inside the window.
  expect(blank.y).toBeGreaterThanOrEqual(0);
  expect(blank.y + blank.height).toBeLessThanOrEqual(WINDOW.height);
  expect(blank.share).toBeGreaterThan(0.3);

  // ── THE TOOLS ARE LIVE on an empty document ──────────────────────────────
  await expect(page.getByLabel("Template")).toBeEnabled();
  await expect(page.getByLabel("Per page")).toBeEnabled();
  await page.getByLabel("Template").selectOption("tearsheet");
  await expect(page.getByText(/Tearsheet · no lots yet/)).toBeVisible();
  await expect(frame.locator(".page--empty")).toHaveCount(1);
  await page.getByLabel("Template").selectOption("catalogue");
  await expect(page.getByText(/Catalogue · no lots yet/)).toBeVisible();

  // ── THE ONE WAY TO FILL IT is on the canvas, and nothing prints yet ──────
  const importLots = page.getByRole("link", { name: "Import lots" });
  await expect(importLots).toHaveCount(1);
  await expect(importLots).toHaveAttribute("href", `${new URL(eventUrl).pathname}/import`);
  await expect(page.getByRole("link", { name: "Download PDF" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Lots" })).toHaveCount(0);
  await page.screenshot({ path: shot("70-editor-blank") });

  // ── THE RAIL COMES BACK: by button, focus staying on the button ──────────
  await toggle(page).click();
  await expect(toggle(page)).toHaveAttribute("aria-expanded", "true");
  await expect(rail(page)).toBeVisible();
  await expect(rail(page).getByRole("link", { name: /^Catalogues/ })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(toggle(page)).toBeFocused();
  await page.screenshot({ path: shot("71-editor-rail-back") });

  // REMEMBERED. The editor's default is away; the viewer said otherwise, and a
  // reload is not a second opinion — and it is applied before first paint, so
  // there is nothing to catch flashing.
  await page.reload();
  await expect(toggle(page)).toHaveAttribute("aria-expanded", "true");
  await expect(rail(page)).toBeVisible();

  // ── AND GOES, by keyboard, focus coming out of the hidden rail ───────────
  await rail(page).getByRole("link", { name: /^Exports/ }).focus();
  await page.keyboard.press("Control+\\");
  await expect(toggle(page)).toHaveAttribute("aria-expanded", "false");
  await expect(rail(page)).toBeHidden();
  await expect(toggle(page)).toBeFocused();

  // ── THE CHOICE FOLLOWS THE VIEWER to a screen whose default is open ──────
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Events" })).toBeVisible();
  await expect(toggle(page)).toHaveAttribute("aria-expanded", "false");
  await expect(rail(page)).toBeHidden();
  await page.screenshot({ path: shot("72-ledger-rail-away") });

  // ── THE SHORTCUT NEVER TAKES A KEYSTROKE FROM A FIELD ────────────────────
  await page.getByLabel("Event name").focus();
  await page.keyboard.press("Control+\\");
  await expect(toggle(page)).toHaveAttribute("aria-expanded", "false");
  await page.getByLabel("Event name").blur();
  await page.keyboard.press("Control+\\");
  await expect(toggle(page)).toHaveAttribute("aria-expanded", "true");
  await expect(rail(page)).toBeVisible();
});

test("the page takes the window", async ({ page }) => {
  const { eventUrl, editorUrl } = await createEvent(page, `Window Sale ${RUN}`);
  await page.getByRole("link", { name: "Import lots" }).click();
  await page
    .locator("textarea")
    .first()
    .fill(
      `編號\t品名\t作者\t估價\n` +
        Array.from({ length: 10 }, (_, i) =>
          [ref(i + 1), `拍品 ${i + 1}`, "佚名", "80,000 – 120,000 HKD"].join("\t"),
        ).join("\n"),
    );
  await page.getByRole("button", { name: "Read this text" }).click();
  await page.getByRole("button", { name: /Import 10 lots/ }).click();
  await page.waitForURL(eventUrl);

  await page.goto(editorUrl);
  const frame = frameOf(page);
  await expect(frame.locator(".page")).toHaveCount(3);
  await expect(page.getByLabel("Fit")).toHaveValue("page");

  // ── THE NUMBER ───────────────────────────────────────────────────────────
  const rect = await pageRect(page);
  const line =
    `A4 page ${Math.round(rect.width)}×${Math.round(rect.height)} in ${WINDOW.width}×${WINDOW.height}: ` +
    `${(rect.share * 100).toFixed(1)}% of the window (was ${(BEFORE * 100).toFixed(1)}%; ` +
    `fit-page ceiling ${(CEILING * 100).toFixed(1)}%)`;
  console.log(line);
  test.info().annotations.push({ type: "canvas share", description: line });
  // The floor. Not the ceiling: two toolbar rows are what the controls cost,
  // and a number tuned to the exact pixel would fail on the next font.
  expect(rect.share).toBeGreaterThan(0.32);
  expect(rect.share).toBeGreaterThan(BEFORE * 1.4);
  // Fit-page means the WHOLE page: bigger and cut off is not an improvement.
  expect(rect.y).toBeGreaterThanOrEqual(0);
  expect(rect.y + rect.height).toBeLessThanOrEqual(WINDOW.height);
  expect(rect.width / rect.height).toBeCloseTo(A4, 2);
  await page.screenshot({ path: shot("73-editor-page") });

  // ── THE LOTS PANEL CAN BE PUT AWAY, and the frame takes its width ────────
  const panel = page.getByRole("complementary", { name: "Lots in this catalogue" });
  const lots = page.getByRole("button", { name: "Lots" });
  await expect(panel).toBeVisible();
  await expect(lots).toHaveAttribute("aria-expanded", "true");
  const withPanel = (await page.locator('iframe[title="Catalogue preview"]').boundingBox())!;

  await lots.click();
  await expect(lots).toHaveAttribute("aria-expanded", "false");
  await expect(panel).toBeHidden();
  const without = (await page.locator('iframe[title="Catalogue preview"]').boundingBox())!;
  expect(without.width).toBeGreaterThan(withPanel.width + 300);
  // Width is not what a fit-page page wanted; it is the same size, centred.
  const after = await pageRect(page);
  expect(after.width).toBeCloseTo(rect.width, 0);
  await page.screenshot({ path: shot("74-editor-panel-away") });

  // REMEMBERED, and applied before paint.
  await page.reload();
  await expect(lots).toHaveAttribute("aria-expanded", "false");
  await expect(panel).toBeHidden();

  // ── FIT WIDTH now has the whole window to fill ───────────────────────────
  await page.getByLabel("Fit").selectOption("width");
  await expect
    .poll(async () => (await pageRect(page)).width)
    .toBeGreaterThan(without.width - 40);
  await page.screenshot({ path: shot("75-editor-fit-width") });

  // Back, both of them — a choice is reversible or it is a lock.
  await page.getByLabel("Fit").selectOption("page");
  await lots.click();
  await expect(panel).toBeVisible();
  await expect(lots).toHaveAttribute("aria-expanded", "true");
});
