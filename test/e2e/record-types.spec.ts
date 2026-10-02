// A house defines what kinds of thing it sells, and the import honours it.
//
// ── WHAT ONLY A BROWSER CAN SAY ────────────────────────────────────────────
//
// The vocabulary, the form's round trip and the reader are all exercised in
// node, exhaustively. What none of them can reach is the SEAM: that a kind
// defined on the settings screen is the kind the import screen offers, that
// the complaint appears before anything is written, and that the import still
// completes afterwards — because the type reports and never refuses, and a
// product that refused would leave a house with nothing an hour before a sale.

import { expect, test, type Page } from "@playwright/test";

import { createEvent, pasteAndRead } from "./sale";
import { shot } from "./shots";

const RUN = Date.now();
const REF = `RT${RUN}`;

test.use({ viewport: { width: 1440, height: 900 } });
test.describe.configure({ timeout: 180_000 });

const kinds = (page: Page) =>
  page.locator("section").filter({ hasText: "What kinds of thing this house sells" });

/**
 * Leave the house with no kinds defined.
 *
 * ONE ORG, ONE COLUMN, EVERY OTHER SPEC DOWNSTREAM OF IT — the same hazard
 * `visibility.spec.ts` carries about `field_policy`, and the same remedy: put
 * it back whatever happens, in a `finally`.
 */
async function clearKinds(page: Page): Promise<void> {
  await page.goto("/settings");
  const remove = kinds(page).getByRole("button", { name: "Remove this kind" });
  for (let n = await remove.count(); n > 0; n = await remove.count()) {
    await remove.first().click();
  }
  await kinds(page).getByRole("button", { name: "Save kinds" }).click();
  await expect(kinds(page).getByText(/No kinds are defined|kinds? of thing/)).toBeVisible({
    timeout: 30_000,
  });
}

test("a house names a kind, and the import is checked against it", async ({ page }) => {
  try {
    // ── THE HOUSE SAYS WHAT A WATCH IS ────────────────────────────────────
    await page.goto("/settings");
    await expect(kinds(page)).toContainText("No kinds defined");

    await kinds(page).getByRole("button", { name: "Add a kind" }).click();
    await kinds(page).getByLabel("中文名稱").fill("腕錶");
    await kinds(page).getByLabel("In English").fill("Watch");

    // One column that must be there, and one that is a closed set.
    await kinds(page).getByLabel("Column name").first().fill("機芯");
    await kinds(page).getByLabel("on every lot").first().check();

    await kinds(page).getByRole("button", { name: "Add a column" }).click();
    await kinds(page).getByLabel("Column name").nth(1).fill("品相");
    await kinds(page).getByLabel("What this column is").nth(1).selectOption("select");
    await kinds(page).getByLabel("The options for this column").nth(1).fill("A、B、C");

    await kinds(page).getByRole("button", { name: "Save kinds" }).click();
    await expect(kinds(page).getByText(/1 kind of thing/)).toBeVisible({ timeout: 30_000 });
    await page.screenshot({ path: shot("95-record-type-defined"), fullPage: true });

    // AND IT SURVIVES A RELOAD, which is what makes it a definition rather
    // than a thing on a screen.
    await page.reload();
    await expect(kinds(page).getByLabel("中文名稱")).toHaveValue("腕錶");
    await expect(kinds(page).getByLabel("The options for this column").nth(1)).toHaveValue(
      "A、B、C",
    );

    // ── AND THE IMPORT SCREEN NOW OFFERS IT ───────────────────────────────
    const { eventUrl } = await createEvent(page, `Watch Sale ${RUN}`);
    await page.goto(`${eventUrl}/import`);
    // 品相 is wrong on one row and 機芯 is missing on the other — both of the
    // things a kind exists to catch, in one file.
    await pasteAndRead(
      page,
      `編號,品名,機芯,品相\n` +
        `${REF}-1,青花梅瓶,Cal. 324,D\n` +
        `${REF}-2,山水四屏,,A\n`,
    );

    const picker = page.getByLabel("These are");
    await expect(picker).toBeVisible();
    await picker.selectOption({ label: "腕錶 · Watch" });

    // ── THE COMPLAINT ARRIVES BEFORE ANYTHING IS WRITTEN ──────────────────
    // The whole promise of this screen is "nothing is written until you have
    // seen it"; a type that only complained afterwards would be a rule
    // somebody meets with the lots already in the database.
    await expect(page.getByText(/品相 is one of/)).toBeVisible();
    await expect(page.getByText(/機芯 is needed on every lot/)).toBeVisible();
    // COUNTED PER COLUMN, not per lot: one line each, naming how many.
    await expect(page.getByText(/— on 1 of 2/).first()).toBeVisible();
    await page.screenshot({ path: shot("96-record-type-complaints"), fullPage: true });

    // ── AND IT STILL IMPORTS, BECAUSE IT REPORTS AND NEVER REFUSES ────────
    // Principle 9. The values may have arrived from a client an hour before a
    // sale, and a product that declined would leave the house with nothing.
    await page.getByRole("button", { name: /Import 2 lots/ }).click();
    await page.waitForURL(eventUrl);
    await expect(page.getByRole("status")).toContainText("of 2");
  } finally {
    // See `clearKinds`: one org, one column, every other spec downstream.
    await clearKinds(page);
  }
});
