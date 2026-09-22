// Templates, driven — and the assertion that the page changed SHAPE.
//
// ROADMAP D6. A price list is a table and a catalogue is a grid, and a test
// that only counted pages would pass on two identical layouts. So this switches
// the template through the real control and asserts on the markup the frame
// holds: table rows under a header, then a description list on a sheet, then
// cells in a grid again — one renderer, one preview route, one PDF route. And it
// makes a correction BEFORE switching, so the claim that a template change loses
// nothing is measured on a real override rather than asserted.
//
// The screenshots are the point. A price list that renders as an ugly grid
// passes every assertion in this file and fails the first person who looks.

import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { expect, test, type FrameLocator, type Page } from "@playwright/test";

import { writePlate } from "./plate";
import { createEvent } from "./sale";
import { shot } from "./shots";

const TEMP = join("test-results", "fixtures");
mkdirSync(TEMP, { recursive: true });

const RUN = Date.now();
const PLATE = writePlate(join(TEMP, `template-${RUN}.png`), 600, 450, RUN % 200);
const EVENT = `Template Sale ${RUN}`;
const REF = `T${RUN}`;
const ref = (n: number): string => `${REF}-${n}`;

const LONG =
  "此作為張大千一九六零年代潑墨潑彩之代表，四屏連貫，山勢自左而右層層推展，" +
  "墨色與石青石綠交融，既見傳統皴法根基，亦具抽象表現之氣象。" +
  "畫心完好，原裝舊裱，題識與鈐印俱全，為近年市場所見同類作品中尺幅最鉅者之一。";

// Twelve lots: three pages at four-up, one page of a twenty-row price list,
// twelve tearsheets. Lot 3 and lot 10 have no maker, so a table has to show an
// empty cell; lot 2 carries the long description a sheet must print whole; the
// last column is the house's own and is not one the matcher knows.
const LOTS: [string, string, string, string, string][] = [
  ["青花纏枝蓮紋梅瓶", "佚名", "800,000 – 1,200,000 HKD", "器形端莊，釉色瑩潤。", "全品"],
  ["山水四屏", "張大千", "3,500,000 – 4,800,000 HKD", LONG, ""],
  ["白玉雕螭龍紋佩", "", "180,000 – 260,000 HKD", "玉質溫潤。", "微磕"],
  ["墨荷", "齊白石", "400,000 – 600,000 HKD", "", ""],
  ["秋山圖", "張大千", "800,000 – 1,200,000 HKD", "", ""],
  ["紫砂壺", "顧景舟", "200,000 – 300,000 HKD", "", ""],
  ["行書七言聯", "于右任", "60,000 – 80,000 HKD", "", ""],
  ["粉彩過枝桃紋盤", "佚名", "150,000 – 200,000 HKD", "", ""],
  ["剔紅牡丹紋圓盒", "佚名", "40,000 – 60,000 HKD", "", ""],
  ["翡翠手鐲", "", "500,000 – 700,000 HKD", "", "全品"],
  ["銅鎏金釋迦牟尼坐像", "佚名", "1,200,000 – 1,800,000 HKD", "", ""],
  ["黃花梨方角櫃成對", "佚名", "2,000,000 – 3,000,000 HKD", "", ""],
];

const frameOf = (page: Page): FrameLocator =>
  page.frameLocator('iframe[title="Catalogue preview"]');
// ANCHORED, because with twelve lots the reference of lot 1 is a substring of
// lots 10, 11 and 12, and a substring match selected four slots.
const slotOf = (frame: FrameLocator, r: string) =>
  frame.locator(".slot").filter({ has: frame.locator(".ref", { hasText: new RegExp(`^${r}$`) }) });
const panel = (page: Page) =>
  page.getByRole("complementary", { name: "Lots in this catalogue" });

// The PDF at the end pays Chromium's first launch; see pdf.spec.ts.
test.describe.configure({ timeout: 240_000 });

test("a template changes the shape of the page, and a correction survives it", async ({
  page,
}) => {
  // ── A sale, through the ordinary path ────────────────────────────────────
  const { eventUrl } = await createEvent(page, EVENT);

  // From the blank editor's canvas, where quick-add lands.
  await page.getByRole("link", { name: "Import lots" }).first().click();
  await page
    .locator("textarea")
    .first()
    .fill(
      `編號\t品名\t作者\t估價\t描述\t品相\n` +
        LOTS.map((row, i) => [ref(i + 1), ...row].join("\t")).join("\n"),
    );
  await page.getByRole("button", { name: "Read this text" }).click();
  // The house's own column is kept under its own header, not skipped.
  await expect(page.getByLabel("What 品相 becomes")).toHaveValue("custom");
  await page.getByRole("button", { name: /Import 12 lots/ }).click();
  await page.waitForURL(eventUrl);

  // A plate on the first lot, so every shape has a photograph to place.
  await page.getByRole("link", { name: ref(1) }).first().click();
  await page.waitForURL(/\/lots\//);
  await page.locator('input[type="file"]').setInputFiles([PLATE]);
  await expect(page.locator("figure")).toHaveCount(1, { timeout: 60_000 });

  // ── The catalogue: a grid, as it always was ──────────────────────────────
  await page.goto(`${eventUrl}/catalogue`);
  const frame = frameOf(page);
  await expect(frame.locator(".page")).toHaveCount(3);
  await expect(frame.locator(".page--grid .grid")).toHaveCount(3);
  await expect(frame.locator("table")).toHaveCount(0);
  await expect(frame.locator(".slot")).toHaveCount(12);
  await expect(page.getByLabel("Template")).toHaveValue("catalogue");
  await expect(page.getByLabel("Per page")).toHaveValue("4");
  await expect(page.getByText(/Catalogue · 3 pages · 12 lots/)).toBeVisible();
  // The grid decides per lot: no maker, no maker line.
  await expect(slotOf(frame, ref(3)).locator(".line--maker")).toHaveCount(0);

  // ── A correction, made on the grid ───────────────────────────────────────
  await panel(page).getByRole("link", { name: new RegExp(ref(2)) }).click();
  await page.waitForURL(/\/lots\//);
  await page.getByLabel("Hide 作者 in this catalogue").check();
  await page.getByRole("button", { name: "Apply to this catalogue" }).click();
  await expect(page.getByRole("status").filter({ hasText: /Applied to this catalogue/ })).toBeVisible();
  await page.getByRole("link", { name: "Open catalogue" }).click();
  await expect(page.getByRole("heading", { name: "Catalogue" })).toBeVisible();
  await expect(slotOf(frame, ref(2)).locator(".line--maker")).toHaveCount(0);
  await expect(slotOf(frame, ref(5)).locator(".line--maker")).toContainText("張大千");
  await page.screenshot({ path: shot("50-template-catalogue"), fullPage: true });

  // ── THE PRICE LIST: a table ──────────────────────────────────────────────
  await page.getByLabel("Template").selectOption("price-list");
  await expect(frame.locator(".page--table table")).toHaveCount(1); // 12 of 20 rows
  await expect(frame.locator(".grid")).toHaveCount(0);
  await expect(frame.locator("tr.slot")).toHaveCount(12);
  // The header names the columns, in the template's order.
  await expect(frame.locator("thead th")).toHaveCount(5);
  await expect(frame.locator("thead th.ref")).toHaveText("編號");
  await expect(frame.locator("thead th.line--title")).toHaveText("品名");
  await expect(frame.locator("thead th.line--maker")).toHaveText("作者");
  await expect(frame.locator("thead th.line--price")).toHaveText("估價");
  // Every row has every column — the maker cell of a lot with no maker is
  // there, and empty, so the eye can run down the estimate column.
  for (const row of await frame.locator("tr.slot").all()) {
    await expect(row.locator("td")).toHaveCount(5);
  }
  await expect(slotOf(frame, ref(3)).locator("td.line--maker .value")).toHaveCount(0);
  await expect(slotOf(frame, ref(5)).locator("td.line--maker .value")).toHaveText("張大千");
  // THE THESIS: the override made on the grid holds on the table. Lot 2's
  // maker cell is empty; lot 5, by the same maker, is the control.
  await expect(slotOf(frame, ref(2)).locator("td.line--maker .value")).toHaveCount(0);
  // The plate is a thumbnail column; the lot without one has the cell.
  await expect(slotOf(frame, ref(1)).locator("td.plate img")).toHaveCount(1);
  await expect(slotOf(frame, ref(3)).locator("td.plate img")).toHaveCount(0);
  // The house's own column is not a fifth column: the template did not name it.
  await expect(frame.locator("thead th", { hasText: "品相" })).toHaveCount(0);
  // The controls read the template's vocabulary, not the engine's.
  await expect(page.getByLabel("Per page")).toHaveValue("20");
  await expect(page.getByLabel("Per page").locator("option")).toHaveCount(3);
  await expect(page.getByLabel("Photograph")).toBeDisabled();
  await expect(page.getByText(/Price list · 1 pages · 12 lots/)).toBeVisible();
  await page.screenshot({ path: shot("51-template-price-list"), fullPage: true });

  // ── THE TEARSHEET: a page per lot ────────────────────────────────────────
  await page.getByLabel("Template").selectOption("tearsheet");
  await expect(frame.locator(".page--sheet")).toHaveCount(12);
  await expect(frame.locator(".slot--sheet")).toHaveCount(12);
  await expect(frame.locator("dl.caption")).toHaveCount(12);
  await expect(frame.locator("table")).toHaveCount(0);
  await expect(frame.locator(".grid")).toHaveCount(0);
  // The whole description, not a line of it.
  await expect(slotOf(frame, ref(2)).locator(".line--description .value")).toHaveText(LONG);
  // The specifications carry their labels; the house's own column prints, labelled.
  await expect(slotOf(frame, ref(1)).locator(".line--price .label")).toHaveText("估價");
  await expect(slotOf(frame, ref(1)).locator(".line.labelled .label", { hasText: "品相" })).toBeVisible();
  // And the correction still stands.
  await expect(slotOf(frame, ref(2)).locator(".line--maker")).toHaveCount(0);
  await expect(slotOf(frame, ref(5)).locator(".line--maker .value")).toHaveText("張大千");
  // One to a page is the template's fact, so the control says so and offers nothing else.
  await expect(page.getByLabel("Per page")).toHaveValue("1");
  await expect(page.getByLabel("Per page")).toBeDisabled();
  await expect(page.getByText(/Tearsheet · 12 pages · 12 lots/)).toBeVisible();
  await page.screenshot({ path: shot("52-template-tearsheet"), fullPage: true });

  // ── The deliverable prints whatever is chosen ────────────────────────────
  const response = await page.request.get(`${eventUrl}/catalogue/pdf`, { timeout: 180_000 });
  // A machine with no Chromium explains itself with a 503 (pdf.spec.ts holds
  // that). One WITH a browser configured must print, or the header assertions
  // below would be skipped in silence on exactly the machines that can run them.
  if (process.env.PUPPETEER_EXECUTABLE_PATH) expect(response.status()).toBe(200);
  else expect([200, 503]).toContain(response.status());
  if (response.status() === 200) {
    const headers = response.headers();
    expect(headers["x-taptap3d-template"]).toBe("tearsheet");
    expect(Number(headers["x-taptap3d-pages"])).toBe(12);
    expect(Number(headers["x-taptap3d-lots"])).toBe(12);
    expect(headers["content-disposition"]).toContain("tearsheet.pdf");
    expect(headers["x-taptap3d-cjk"]).toBe("rendered");
  }

  // ── What the printer sees, whole pages of it ─────────────────────────────
  // Print media on the same preview document, at a viewport tall enough to
  // hold an A4 page, so the screenshot is a page and not the top third of one.
  await page.setViewportSize({ width: 900, height: 1240 });
  await page.emulateMedia({ media: "print" });
  await page.goto(`${eventUrl}/catalogue/preview`);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: shot("53-tearsheet-print"), fullPage: false });
  await page.emulateMedia({ media: null });
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.goto(`${eventUrl}/catalogue`);
  await page.getByLabel("Template").selectOption("price-list");
  await expect(frame.locator("tr.slot")).toHaveCount(12);
  await page.setViewportSize({ width: 900, height: 1240 });
  await page.emulateMedia({ media: "print" });
  await page.goto(`${eventUrl}/catalogue/preview`);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: shot("54-price-list-print"), fullPage: false });
  await page.emulateMedia({ media: null });
  await page.setViewportSize({ width: 1440, height: 900 });

  // ── And back: the grid, the density, the correction ──────────────────────
  await page.goto(`${eventUrl}/catalogue`);
  await page.getByLabel("Template").selectOption("catalogue");
  await expect(frame.locator(".page--grid .grid")).toHaveCount(3);
  await expect(frame.locator("tr.slot")).toHaveCount(0);
  await expect(page.getByLabel("Per page")).toHaveValue("4");
  await expect(slotOf(frame, ref(2)).locator(".line--maker")).toHaveCount(0);
  await expect(slotOf(frame, ref(5)).locator(".line--maker")).toContainText("張大千");
  // Reversible, and the record prints again — on this shape as on any.
  await panel(page).getByRole("link", { name: new RegExp(ref(2)) }).click();
  await page.waitForURL(/\/lots\//);
  await page.getByLabel("Hide 作者 in this catalogue").uncheck();
  await page.getByRole("button", { name: "Apply to this catalogue" }).click();
  await expect(page.getByRole("status").filter({ hasText: /Applied to this catalogue/ })).toBeVisible();
  await page.getByRole("link", { name: "Open catalogue" }).click();
  await expect(slotOf(frame, ref(2)).locator(".line--maker")).toContainText("張大千");
});
