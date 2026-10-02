// The review layer, driven.
//
// ── WHAT ONLY A BROWSER CAN SAY HERE ───────────────────────────────────────
//
// `test/comments.db.test.ts` covers the data layer exhaustively — the four
// ways a stale browser can ask for a remark that must not be written, the
// thread ordering, the settling. All of it passes with the panel wired to
// nothing.
//
// What this adds is the seam: that a person can select a part of the page and
// have the remark land on THAT part, that the column takes its turn so a
// reviewer who clicks a plate does not lose the thread they were reading, and
// that settling is a record rather than a delete.

import { expect, test, type Page } from "@playwright/test";

import { createEvent, pasteAndRead } from "./sale";
import { shot } from "./shots";

const RUN = Date.now();
const REF = `CM${RUN}`;
const ref = (n: number): string => `${REF}-${n}`;

test.use({ viewport: { width: 1440, height: 900 } });
test.describe.configure({ timeout: 180_000 });

const comments = (page: Page) =>
  page.getByRole("region", { name: "Comments on this catalogue" });

async function importLots(page: Page, eventUrl: string, count: number): Promise<void> {
  await page.goto(`${eventUrl}/import`);
  // `pasteAndRead` AND NOT A BARE `fill`, which is what this was and why it
  // failed on webkit under full-suite load. React tracks the last value it set
  // on a controlled input, so filling the same string twice is not a change
  // and no input event fires — the helper clears first and retries until the
  // button is enabled. test/e2e/sale.ts carries the measurement.
  await pasteAndRead(
    page,
    `編號\t品名\t作者\t估價\n` +
      Array.from({ length: count }, (_, i) =>
        [ref(i + 1), `拍品 ${i + 1}`, "佚名", "80,000 – 120,000 HKD"].join("\t"),
      ).join("\n"),
  );
  await page.getByRole("button", { name: new RegExp(`Import ${count} lots`) }).click();
  await page.waitForURL(eventUrl);
}

test("a house argues about a page, and the argument is kept", async ({ page }) => {
  const { eventUrl, editorUrl } = await createEvent(page, `Review Sale ${RUN}`);
  await importLots(page, eventUrl, 4);
  await page.goto(editorUrl);

  const preview = page.frameLocator('iframe[title="Catalogue preview"]');
  await expect(preview.locator(".page").first()).toBeVisible();

  // ── THE MODE IS OFF UNTIL SOMEBODY TURNS IT ON ──────────────────────────
  // A panel that is always open is a panel in the way of the job most people
  // opened this screen to do.
  const toggle = page.getByRole("button", { name: /^Comments/ });
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(comments(page)).toHaveCount(0);

  await toggle.click();
  await expect(comments(page)).toBeVisible();
  // SAYS WHAT TO DO rather than that there is nothing — an empty panel that
  // only reports emptiness is a screen a person leaves.
  await expect(comments(page)).toContainText(/Point at a caption or a plate/);

  // ── A REMARK NEEDS A SUBJECT, AND THE CANVAS IS WHERE ONE IS CHOSEN ─────
  const caption = preview.locator('[data-field="title"]').first();
  await caption.click();
  await expect(comments(page).getByRole("textbox")).toBeVisible();

  await comments(page).getByRole("textbox").fill("作者有誤，應為佚名。");
  await comments(page).getByRole("button", { name: "Comment", exact: true }).click();
  await expect(comments(page).locator("[data-thread]")).toHaveCount(1, { timeout: 30_000 });
  await expect(comments(page)).toContainText("作者有誤，應為佚名。");
  // IT SAYS WHAT IT IS ABOUT. The whole value of keying a remark to
  // (lot, field) rather than to a place on a page is that this line stays
  // true at every density and in every template.
  await expect(comments(page).locator("[data-thread]").first()).toContainText("title");
  await page.screenshot({ path: shot("80-comment-made"), fullPage: true });

  // ── AND A REPLY GOES UNDER IT, NOT BESIDE IT ───────────────────────────
  await comments(page).getByRole("button", { name: "Reply" }).first().click();
  await comments(page).getByLabel("Reply to this comment").fill("已確認，照改。");
  await comments(page).getByRole("button", { name: "Send reply" }).click();
  await expect(comments(page)).toContainText("已確認，照改。", { timeout: 30_000 });
  // Still ONE thread: a reader that returned replies as threads would draw
  // the same conversation twice.
  await expect(comments(page).locator("[data-thread]")).toHaveCount(1);

  // ── THE COLUMN TAKES ITS TURN, AND COMMENTS WIN ────────────────────────
  //
  // THE FAILURE THIS GUARDS: a reviewer reads a remark, clicks the plate it
  // is about to see what is wrong, and the polish panel replaces the thread
  // they were halfway through. Comment mode is a thing they turned ON; a
  // selection is a thing that happens whenever a pointer lands.
  await preview.locator('[data-field="images"]').first().click();
  await expect(comments(page)).toBeVisible();
  await expect(comments(page)).toContainText("作者有誤，應為佚名。");

  // ── SETTLING IS A RECORD, NOT A DELETE ─────────────────────────────────
  // "We discussed this and decided no" is the answer to whoever asks again
  // next week.
  await comments(page).getByRole("button", { name: "Settle" }).first().click();
  await expect(comments(page).getByRole("button", { name: /Show 1 settled/ })).toBeVisible({
    timeout: 30_000,
  });
  await expect(comments(page).locator("[data-thread]")).toHaveCount(0);

  await comments(page).getByRole("button", { name: /Show 1 settled/ }).click();
  const settled = comments(page).locator("[data-thread]").first();
  await expect(settled).toContainText("作者有誤，應為佚名。");
  await expect(settled).toContainText("Settled");
  await page.screenshot({ path: shot("81-comment-settled"), fullPage: true });

  // And it can be reopened, because a thread closed by mistake must not be
  // closed forever.
  await comments(page).getByRole("button", { name: "Reopen" }).click();
  await expect(comments(page).getByRole("button", { name: "Settle" })).toBeVisible({
    timeout: 30_000,
  });

  // ── THE COUNT IS ON THE SWITCH, so a catalogue somebody has left remarks
  //    on says so with the mode OFF. A review nobody can see they have been
  //    sent is a review that happens in email instead.
  await toggle.click();
  await expect(comments(page)).toHaveCount(0);
  await expect(toggle).toContainText("1");

  // ── AND IT SURVIVES A RELOAD, which is what makes it a record rather than
  //    a thing on a screen.
  await page.reload();
  await expect(page.getByRole("button", { name: /^Comments/ })).toContainText("1");
});
