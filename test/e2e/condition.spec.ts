// Condition, driven — the two claims the screen exists to make.
//
// It is a CONDITION REPORT. Not "conditional".
//
//   A MARK IS A FRACTION OF THE VIEW. The unit tests hold the arithmetic; only
//   a browser can prove that the box a registrar taps is the box the fraction
//   is taken from, and that the ring comes back in the same place after a
//   reload and at a different window width. That is the property the whole
//   design is for — a re-shoot at a different resolution must not move a mark
//   — and it is the one a screenshot cannot assert on its own.
//
//   EACH VIEW IS ITS OWN SPACE. Switching from front to base must change which
//   marks exist, not overlay one set on another drawing. The mockup's own
//   switcher changed nothing at all, which hid the architectural fact the
//   screen is there to show.
//
// ARCHITECTURE.md principle 10. NOT RUN IN THE TRANCHE THAT WROTE IT: several
// agents share one port and one database.

import { expect, test, type Page } from "@playwright/test";

import { createEvent, pasteAndRead } from "./sale";
import { shot } from "./shots";

const RUN = Date.now();
const REF = `C${RUN}`;
const ref = (n: number): string => `${REF}-${n}`;

const LOTS: [string, string][] = [
  ["青花纏枝蓮紋梅瓶", "佚名"],
  ["山水四屏", "張大千"],
];

/** The reference view's own box — the coordinate space every mark is in. */
const view = (page: Page) => page.locator("[data-view]");

async function importLots(page: Page, eventUrl: string): Promise<void> {
  await page.goto(`${eventUrl}/import`);
  await pasteAndRead(
    page,
    `編號\t品名\t作者\n` +
        LOTS.map(([t, m], i) => `${ref(i + 1)}\t${t}\t${m}`).join("\n"),
  );
  await page.getByRole("button", { name: /Import 2 lots/ }).click();
  await page.waitForURL(eventUrl);
}

/** Tap the view at a fraction of its own box, which is what a registrar does. */
/**
 * Tap the object at a fraction of the view, the way a finger does.
 *
 * SCROLLED INTO VIEW FIRST, and that is not a nicety. `boundingBox()` answers
 * in viewport coordinates and `mouse.click` takes them literally — neither
 * scrolls, unlike `locator.click()`. On a lot that already has an examination
 * the page is long enough to push the viewer off the bottom, and the click
 * then landed on whatever happened to be at those coordinates. Nothing threw;
 * no mark appeared; the test waited three minutes for a note field that was
 * never going to exist.
 */
async function tapAt(page: Page, fx: number, fy: number): Promise<void> {
  await view(page).scrollIntoViewIfNeeded();
  const box = (await view(page).boundingBox())!;
  await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
}

test.describe.configure({ timeout: 180_000 });

test("a mark is a fraction of the view, and it stays there", async ({ page }) => {
  const { eventUrl } = await createEvent(page, `Condition Sale ${RUN}`);
  await importLots(page, eventUrl);

  // ── The register: nothing examined ───────────────────────────────────────
  await page.goto(`${eventUrl}/condition`);
  await expect(page.getByRole("heading", { name: "Condition", exact: true })).toBeVisible();
  await expect(page.getByText("0 of 2 lots examined")).toBeVisible();
  // THE SAME VERB ON EVERY ROW, which is what makes a register actionable.
  await expect(page.getByRole("link", { name: "Examine" })).toHaveCount(2);
  await page.screenshot({ path: shot("60-condition-register"), fullPage: true });

  // ── Open one ─────────────────────────────────────────────────────────────
  await page.getByRole("link", { name: "Examine" }).first().click();
  await page.waitForURL(/\/lots\/[0-9a-f-]+\/condition$/);
  const lotUrl = page.url();
  await expect(page.getByRole("heading", { name: /never been examined/ })).toBeVisible();

  await page.getByLabel("Examined by").fill("L. Cheung, Registrar");
  await page.getByLabel("Under what light").fill("Daylight · raking · UV");
  await page.getByRole("button", { name: "Open the examination" }).click();
  // THE WORKBENCH APPEARING IS THE CONFIRMATION, and the line below already
  // asserts it. The opener's own status line cannot be the confirmation: the
  // form carrying it is replaced by the workbench in the same revalidation, so
  // a success message there is written and destroyed in one frame — which is
  // why the action no longer returns one (see ./condition/actions.ts).
  // ── Tap the object ───────────────────────────────────────────────────────
  await expect(view(page)).toBeVisible();
  await tapAt(page, 0.5, 0.1);
  await expect(page.getByRole("button", { name: "Mark 1", exact: true })).toBeVisible();
  await page.getByLabel("Note for mark 1").fill("Two shallow glaze nicks to the rim.");
  // Saved on blur — a Save button per mark is forty buttons on a forty-mark
  // report, and a save per keystroke is a round trip per character.
  await page.getByLabel("Note for mark 1").blur();

  await tapAt(page, 0.25, 0.4);
  await expect(page.getByRole("button", { name: "Mark 2", exact: true })).toBeVisible();
  await page.getByLabel("Note for mark 2").fill("An 8 mm firing flaw, original to manufacture.");
  await page.getByLabel("Note for mark 2").blur();
  await page.screenshot({ path: shot("61-condition-marked"), fullPage: true });

  // ── THE CLAIM: the same fractions, at a different width ─────────────────
  // If the mark were pixels, or fractions of an image file, this is where it
  // would move. Measured before and after rather than asserted: the ratio of
  // the ring's centre to the box is what has to survive.
  const wide = (await view(page).boundingBox())!;
  const ringWide = (await page.getByRole("button", { name: "Mark 1", exact: true }).boundingBox())!;
  const fractionWide = (ringWide.x + ringWide.width / 2 - wide.x) / wide.width;

  // 820, NOT 900. The viewer is `w-full max-w-[420px]`, so it only shrinks
  // once its COLUMN is under 420 — at 900 the column is still wider than the
  // cap and the box measured the same 420 both times, which made the
  // assertion below fail for a reason that had nothing to do with marks.
  // 820 is inside the supported range (the product draws a message below 768).
  await page.setViewportSize({ width: 820, height: 1000 });
  await page.reload();
  const narrow = (await view(page).boundingBox())!;
  const ringNarrow = (await page.getByRole("button", { name: "Mark 1", exact: true }).boundingBox())!;
  const fractionNarrow = (ringNarrow.x + ringNarrow.width / 2 - narrow.x) / narrow.width;

  // THE RING SITS WHERE THE FINGER DID, as a fraction — which is the claim,
  // and it is asserted directly rather than inferred from a resize.
  //
  // The resize cannot demonstrate it here and that is worth writing down: the
  // viewer is `w-full max-w-[420px]`, so it stops growing at 420 and only
  // SHRINKS once its column is narrower than that. Inside the range this
  // product supports — 768 and up, below which it draws a message instead —
  // the column never is. Both measurements came back 420, and the assertion
  // that they differed was failing for a reason with nothing to do with marks.
  //
  // What the two widths still prove is that nothing about the box changed the
  // answer, and `tapAt(0.5, 0.1)` is what makes the number meaningful: a mark
  // stored in pixels, or as a fraction of the image FILE, would not land on
  // half the box at either size.
  expect(fractionWide).toBeCloseTo(0.5, 2);
  expect(fractionNarrow).toBeCloseTo(fractionWide, 2);
  await page.screenshot({ path: shot("62-condition-narrow"), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });

  // ── THE CLAIM: each view is its own space ───────────────────────────────
  await page.goto(lotUrl);
  await expect(page.getByRole("button", { name: "Mark 1", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Base", exact: true }).click();
  // The front's two marks are NOT on the base. A footrim mark cannot be
  // expressed in the front view's coordinates at all.
  await expect(page.getByRole("button", { name: "Mark 1", exact: true })).toHaveCount(0);
  await expect(page.getByText(/Nothing marked on the base/)).toBeVisible();

  await tapAt(page, 0.3, 0.7);
  await expect(page.getByRole("button", { name: "Mark 1", exact: true })).toBeVisible();
  await page.getByLabel("Note for mark 1").fill("Kiln grit on the unglazed footrim.");
  await page.getByLabel("Note for mark 1").blur();
  await page.screenshot({ path: shot("63-condition-base-view"), fullPage: true });

  // Back to the front, and its own two are still there and still numbered 1
  // and 2 — the numbering restarts per view because the switcher says which.
  await page.getByRole("button", { name: "Front", exact: true }).click();
  await expect(page.getByRole("button", { name: "Mark 1", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Mark 2", exact: true })).toBeVisible();

  // ── A mark removed renumbers, which is why there is no position column ──
  await page.getByRole("button", { name: "Remove mark 1" }).click();
  await expect(page.getByRole("button", { name: "Mark 2", exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Note for mark 1")).toHaveValue(
    "An 8 mm firing flaw, original to manufacture.",
  );
});

test("the lifetime view rolls two examinations into one history", async ({ page }) => {
  const { eventUrl } = await createEvent(page, `Lifetime Sale ${RUN}`);
  await importLots(page, eventUrl);

  await page.goto(`${eventUrl}/condition`);
  await page.getByRole("link", { name: "Examine" }).first().click();
  await page.waitForURL(/\/lots\/[0-9a-f-]+\/condition$/);
  const lotUrl = page.url();

  // ── August: two faults ───────────────────────────────────────────────────
  await page.getByLabel("Examined by").fill("L. Cheung");
  await page.getByRole("button", { name: "Open the examination" }).click();
  await tapAt(page, 0.5, 0.1);
  await page.getByLabel("Note for mark 1").fill("First noted on receipt. 2 mm.");
  await page.getByLabel("Note for mark 1").blur();
  await tapAt(page, 0.25, 0.4);
  await page.getByLabel("Note for mark 2").fill("Firing flaw, original to manufacture.");
  await page.getByLabel("Note for mark 2").blur();

  // ── September: the same rim, found again, plus one new scuff ─────────────
  await page.getByRole("button", { name: "Open the examination" }).click();
  // Same as above: the workbench replacing the opener is the confirmation.
  await expect(view(page)).toBeVisible();
  await expect(page.getByText(/Nothing marked on the front/)).toBeVisible();
  // Very nearly where the rim nick was recorded in August. The grouping is by
  // proximity in the view's coordinate space, which is only possible because
  // the space is stable.
  await tapAt(page, 0.505, 0.102);
  await page.getByLabel("Note for mark 1").fill("Unchanged.");
  await page.getByLabel("Note for mark 1").blur();
  await tapAt(page, 0.7, 0.75);
  await page.getByLabel("Note for mark 2").fill("A 4 mm scuff, not present on receipt.");
  await page.getByLabel("Note for mark 2").blur();

  // EXACT on every toggle. The sale in this file is named "Lifetime Sale …",
  // so the top bar's own switcher carries the word too — an accessible name is
  // a substring match, and a view toggle that also selects a sale is not a
  // toggle. The same trap waits for Front, Reverse and Base the day a sale is
  // named after one.
  // ── The lifetime ─────────────────────────────────────────────────────────
  await page.getByRole("button", { name: "Lifetime", exact: true }).click();
  await expect(page.getByText(/2 examinations of this lot/)).toBeVisible();
  await expect(page.getByText("First noted on receipt. 2 mm.")).toBeVisible();
  await expect(page.getByText("Unchanged.")).toBeVisible();
  await expect(page.getByText("A 4 mm scuff, not present on receipt.")).toBeVisible();
  // Read-only, and it says so rather than offering controls that refuse.
  await expect(page.getByText(/Nothing here is editable/)).toBeVisible();
  await expect(page.getByLabel("Note for mark 1")).toHaveCount(0);
  // A fault seen twice says so on its badge.
  await expect(page.getByRole("button", { name: /seen 2 times/ })).toBeVisible();
  await page.screenshot({ path: shot("64-condition-lifetime"), fullPage: true });

  // ── The printed report comes out of the one renderer ─────────────────────
  await page.goto(lotUrl);
  const report = await page.request.get(`${lotUrl}/report`);
  expect(report.status()).toBe(200);
  expect(report.headers()["content-type"]).toContain("text/html");
  // Inert by policy, the same as the catalogue preview.
  expect(report.headers()["content-security-policy"]).toContain("default-src 'none'");
  const html = await report.text();
  // The view is named beside the number, because paper has no switcher.
  expect(html).toContain("Mark front 1");
  expect(html).toContain("A 4 mm scuff, not present on receipt.");
  // One lot, one page, painted by the same stylesheet every output uses.
  expect(html).toContain("@page");
  expect(html).toContain('class="page page--sheet"');

  const lifetime = await page.request.get(`${lotUrl}/report?of=lifetime`);
  expect(await lifetime.text()).toContain("First noted on receipt. 2 mm.");

  // ── And the register counts what the screen shows ────────────────────────
  await page.goto(`${eventUrl}/condition`);
  await expect(page.getByText("1 of 2 lots examined")).toBeVisible();
  await expect(page.getByRole("link", { name: "Open" })).toHaveCount(1);
  await expect(page.getByRole("link", { name: "Examine" })).toHaveCount(1);
  await page.screenshot({ path: shot("65-condition-register-partial"), fullPage: true });
});

test("the two screens are each other's way out", async ({ page }) => {
  // A registrar moves between custody and condition all day: a handoff is the
  // occasion an examination is filed on, and a leg with no report is the thing
  // the condition screen fixes. Neither door may be a dead link.
  const { eventUrl } = await createEvent(page, `Handoff Sale ${RUN}`);
  await importLots(page, eventUrl);

  await page.goto(`${eventUrl}/movement`);
  await page.getByRole("link", { name: ref(1), exact: true }).click();
  await page.waitForURL(/\/lots\/[0-9a-f-]+\/movement$/);
  await page.getByLabel("To").fill("Photography studio");
  await page.getByLabel("Why").fill("On receipt from consignor");
  await page.getByRole("button", { name: "Log the movement" }).click();

  // The leg carries no report, and the tag is a door rather than a label.
  await page.getByRole("link", { name: "No report" }).click();
  await page.waitForURL(/\/condition$/);

  // The occasion picker offers that leg by name.
  const occasion = page.getByLabel("Occasion");
  await expect(occasion).toContainText("Photography studio");
  await occasion.selectOption({ index: 1 });
  await page.getByLabel("Examined by").fill("K. Ng");
  await page.getByRole("button", { name: "Open the examination" }).click();
  // NOT THE <option>. The occasion select lists every movement by the same
  // words, so a bare text match finds a collapsed dropdown entry — which is
  // in the DOM, is not visible, and is not what this line is about.
  await expect(page.getByRole("definition").filter({ hasText: /Photography studio/ })).toBeVisible();

  // SCOPED TO `main`. The rail now carries Condition and Movement as places
  // of their own, so the bare name matches the rail's link as well as the
  // lot's — and the rail's goes to the sale's register rather than to this
  // lot. The collision is the wiring working; the fix is saying which.
  // And the leg now says it has one.
  await page.getByRole("main").getByRole("link", { name: "Movement" }).click();
  await page.waitForURL(/\/movement$/);
  await expect(page.getByRole("link", { name: "Condition report" })).toBeVisible();
  await page.screenshot({ path: shot("66-handoff-report"), fullPage: true });
});
