// A part, put somewhere by hand — driven, and the numbers that say it worked.
//
// ── WHY THIS CANNOT BE A UNIT TEST ──────────────────────────────────────────
//
// Every function the pointer layer is made of is already tested in node, and
// all of them could pass with this feature broken. The overlay reads boxes out
// of a real `contentDocument`; the drag converts a real pointer's travel into
// page fractions; the commit goes through a server action to a real jsonb
// column; and the answer comes back as a re-derived document in a second
// frame. Nothing in that chain is visible to vitest, and ARCHITECTURE.md
// principle 10 is explicit about what to do instead: run a control and believe
// it. Roughly two dozen defects in the predecessor were found by driving the
// application and none of them by its suite.
//
// So the assertions here are MEASURED, and deliberately compared against the
// renderer's own published numbers rather than against a screenshot:
//
//   data-page-frame    where the server says the part is, in page fractions
//   data-frame-source  that a PERSON put it there rather than the engine
//   data-selection     which (lot, field) the overlay believes is selected
//   data-ring-kind     which ring it drew
//   data-clip-count    how many placed parts are cutting their own text
//
// Comparing a measured box against a re-derivation of the same arithmetic is
// how three of the predecessor's audits measured the wrong thing and
// confidently accused a correct fix; comparing it against an attribute the
// renderer published cannot make that mistake.
//
// Runs against the BUILT application and a real database, one worker.

import { expect, test, type FrameLocator, type Page } from "@playwright/test";

import { createEvent } from "./sale";
import { shot } from "./shots";

const RUN = Date.now();
const REF = `PL${RUN}`;
const ref = (n: number): string => `${REF}-${n}`;

/** The window every number below is stated for. See editor.spec.ts on why. */
const WINDOW = { width: 1440, height: 900 };
test.use({ viewport: WINDOW });

test.describe.configure({ timeout: 180_000 });

const preview = (page: Page): FrameLocator =>
  page.frameLocator('iframe[title="Catalogue preview"]');
const overlay = (page: Page) => page.locator("[data-overlay]");

/** The stored frame the renderer published for one part, or null. */
async function storedFrame(
  page: Page,
  lotId: string,
  field: string,
): Promise<[number, number, number, number] | null> {
  const el = preview(page).locator(`[data-lot="${lotId}"][data-field="${field}"][data-page-frame]`);
  if ((await el.count()) === 0) return null;
  const raw = await el.first().getAttribute("data-page-frame");
  const parts = (raw ?? "").split(",").map(Number);
  return parts.length === 4 ? (parts as [number, number, number, number]) : null;
}

/** A box in WINDOW coordinates: the frame's own box plus the child's inside it. */
async function boxIn(page: Page, selector: string): Promise<{ x: number; y: number; w: number; h: number }> {
  const outer = (await page.locator('iframe[title="Catalogue preview"]').boundingBox())!;
  const inner = await preview(page)
    .locator(selector)
    .first()
    .evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    });
  return { x: outer.x + inner.x, y: outer.y + inner.y, w: inner.w, h: inner.h };
}

/** The preview's own scroll, in child pixels. */
const scrollOf = (page: Page): Promise<number> =>
  preview(page)
    .locator("body")
    .evaluate(() => document.scrollingElement?.scrollTop ?? 0);

async function importLots(page: Page, eventUrl: string, count: number): Promise<void> {
  await page.getByRole("link", { name: "Import lots" }).first().click();
  await page
    .locator("textarea")
    .first()
    .fill(
      `編號\t品名\t作者\t估價\n` +
        Array.from({ length: count }, (_, i) =>
          [ref(i + 1), `拍品 ${i + 1}`, "佚名", "80,000 – 120,000 HKD"].join("\t"),
        ).join("\n"),
    );
  await page.getByRole("button", { name: "Read this text" }).click();
  await page.getByRole("button", { name: new RegExp(`Import ${count} lots`) }).click();
  await page.waitForURL(eventUrl);
}

test("a caption line goes where a person drags it, and stays there", async ({ page }) => {
  const { eventUrl, editorUrl } = await createEvent(page, `Placement Sale ${RUN}`);
  await importLots(page, eventUrl, 8);
  await page.goto(editorUrl);
  await expect(preview(page).locator(".page")).toHaveCount(2);

  // ── EXACTLY ONE FRAME ANSWERS TO THE NAME ────────────────────────────────
  // The back buffer must not be findable as the preview, or five other specs
  // fail on strict mode in a way that reads as a Playwright fault.
  await expect(page.locator('iframe[title="Catalogue preview"]')).toHaveCount(1);
  await expect(page.locator("iframe")).toHaveCount(2);

  const lotId = await preview(page)
    .locator(".slot")
    .first()
    .getAttribute("data-lot");
  expect(lotId).toBeTruthy();

  // ── A CLICK SELECTS, AND WRITES NOTHING ──────────────────────────────────
  const title = await boxIn(page, `[data-lot="${lotId}"][data-field="title"]`);
  await page.mouse.click(title.x + title.w / 2, title.y + title.h / 2);
  await expect(overlay(page)).toHaveAttribute("data-selection", JSON.stringify([lotId, "title"]));
  await expect(page.locator('[data-ring-kind="selected"]')).toHaveCount(1);
  // No override row: the header counts them, and a click is not an edit.
  await expect(page.getByText(/override/)).toHaveCount(0);
  expect(await storedFrame(page, lotId!, "title")).toBeNull();
  await page.screenshot({ path: shot("80-place-selected") });

  // ── THE DRAG ─────────────────────────────────────────────────────────────
  // Down the page and to the right, by an amount larger than any rounding and
  // smaller than the paper.
  const page1 = await boxIn(page, ".page");
  const dx = Math.round(page1.w * 0.12);
  const dy = Math.round(page1.h * 0.18);
  await page.mouse.move(title.x + title.w / 2, title.y + title.h / 2);
  await page.mouse.down();
  await page.mouse.move(title.x + title.w / 2 + dx, title.y + title.h / 2 + dy, { steps: 12 });
  // The ring follows the pointer while the ink has not moved — nothing is
  // written into the preview, so the ring is the only thing that can.
  const ringMid = await page.locator('[data-ring-kind="selected"]').boundingBox();
  expect(ringMid!.y).toBeGreaterThan(title.y + dy / 2);
  await page.screenshot({ path: shot("81-place-dragging") });
  await page.mouse.up();

  // ── THE SERVER'S ANSWER, IN THE RENDERER'S OWN NUMBERS ───────────────────
  await expect.poll(() => storedFrame(page, lotId!, "title")).not.toBeNull();
  const stored = (await storedFrame(page, lotId!, "title"))!;
  const wantX = (title.x - page1.x + dx) / page1.w;
  const wantY = (title.y - page1.y + dy) / page1.h;
  const line =
    `placed at ${stored.map((n) => n.toFixed(4)).join(", ")} ` +
    `(pointer asked for ${wantX.toFixed(4)}, ${wantY.toFixed(4)})`;
  console.log(line);
  test.info().annotations.push({ type: "placement", description: line });
  // Within a fifth of a percent of the page: a hair of rounding between the
  // measured box, the stored fraction and the CSS percentage is expected; a
  // whole slot width is the failure this is watching for.
  expect(stored[0]).toBeCloseTo(wantX, 2);
  expect(stored[1]).toBeCloseTo(wantY, 2);
  expect(stored[2]).toBeCloseTo(title.w / page1.w, 2);
  expect(stored[3]).toBeCloseTo(title.h / page1.h, 2);

  // A PERSON PUT IT THERE. The renderer emits neither attribute for a part the
  // engine placed, so this is not a restatement of the frame above.
  await expect(
    preview(page).locator(`[data-lot="${lotId}"][data-field="title"][data-frame-source="override"]`),
  ).toHaveCount(1);
  await expect(page.getByText(/1 override/)).toBeVisible();
  await page.screenshot({ path: shot("82-place-committed") });

  // ── IT IS A VALUE, NOT A PICTURE: IT SURVIVES A DENSITY CHANGE ───────────
  // The lot moves to another page; the frame says where on ITS page the title
  // sits, and that sentence is as true on the new page as on the old one.
  await page.getByLabel("Per page").selectOption("2");
  await expect(preview(page).locator(".page")).toHaveCount(4);
  const after = (await storedFrame(page, lotId!, "title"))!;
  expect(after).toEqual(stored);

  // ── AND IT REACHES THE PDF, WHICH IS THE DELIVERABLE ─────────────────────
  const pdf = await page.request.get(`${editorUrl}/pdf`);
  expect(pdf.ok()).toBe(true);
  expect((await pdf.body()).byteLength).toBeGreaterThan(1000);
});

test("committing keeps the reader on the page they were looking at", async ({ page }) => {
  // THE NUMBER THE SECOND FRAME EXISTS FOR. A single frame reloads on the new
  // `src` and lands at scroll zero, so an edit on page 9 answers with page 1.
  const { eventUrl, editorUrl } = await createEvent(page, `Scroll Sale ${RUN}`);
  await importLots(page, eventUrl, 40);
  await page.goto(editorUrl);
  await expect(preview(page).locator(".page")).toHaveCount(10);

  // Down to a page nobody can see from the top of the flow.
  await preview(page)
    .locator('[data-page="8"]')
    .evaluate((el) => el.scrollIntoView());
  const before = await scrollOf(page);
  expect(before).toBeGreaterThan(1000);

  const slot = preview(page).locator('[data-page="8"] .slot').first();
  const lotId = await slot.getAttribute("data-lot");
  const title = await boxIn(page, `[data-page="8"] [data-lot="${lotId}"][data-field="title"]`);
  await page.mouse.move(title.x + title.w / 2, title.y + title.h / 2);
  await page.mouse.down();
  await page.mouse.move(title.x + title.w / 2 + 60, title.y + title.h / 2 + 40, { steps: 10 });
  await page.mouse.up();

  await expect.poll(() => storedFrame(page, lotId!, "title")).not.toBeNull();
  // Still exactly one preview after the swap.
  await expect(page.locator('iframe[title="Catalogue preview"]')).toHaveCount(1);
  const kept = await scrollOf(page);
  const line = `scroll ${Math.round(before)} → ${Math.round(kept)} across a commit`;
  console.log(line);
  test.info().annotations.push({ type: "scroll kept", description: line });
  // Within a page's own air. Zero would be the single-frame defect.
  expect(Math.abs(kept - before)).toBeLessThan(40);
  await page.screenshot({ path: shot("83-place-scroll-kept") });
});

test("a click is not an edit, and Escape puts the selection away", async ({ page }) => {
  const { eventUrl, editorUrl } = await createEvent(page, `Click Sale ${RUN}`);
  await importLots(page, eventUrl, 4);
  await page.goto(editorUrl);
  const lotId = await preview(page).locator(".slot").first().getAttribute("data-lot");
  const title = await boxIn(page, `[data-lot="${lotId}"][data-field="title"]`);

  // A HAND SLIPS WHILE IT PRESSES. Two pixels is under the drag threshold, and
  // without one every selection would write a frame for a part nobody moved.
  await page.mouse.move(title.x + 20, title.y + title.h / 2);
  await page.mouse.down();
  await page.mouse.move(title.x + 22, title.y + title.h / 2 - 1);
  await page.mouse.up();
  await expect(overlay(page)).toHaveAttribute("data-selection", JSON.stringify([lotId, "title"]));
  await expect(page.getByText(/override/)).toHaveCount(0);
  await expect(overlay(page)).toHaveAttribute("data-placements", "0");

  // ── ESCAPE WORKS WITH THE FOCUS INSIDE THE FRAME ─────────────────────────
  // A shortcut bound only to the parent window dies the moment the pointer
  // enters the iframe, which is where all of this editor's work happens.
  await page.keyboard.press("Escape");
  await expect(overlay(page)).toHaveAttribute("data-selection", "");
  // THE SELECTION GOES; THE HOVER DOES NOT, and asserting no ring at all was
  // wrong. The pointer is still resting on the title it just let go of, and
  // `ringsFor` suppresses a hover only while it agrees with the selection —
  // "a hover is a whisper and the selection is a statement". So clearing the
  // selection is precisely what lets the whisper be heard, and the part under
  // the pointer goes on saying it can be picked up. What must be gone is the
  // statement.
  await expect(page.locator('[data-ring-kind="selected"]')).toHaveCount(0);
  await expect(page.locator('[data-ring-kind="subject"]')).toHaveCount(0);
});

test("the overlay never takes the wheel", async ({ page }) => {
  // THE PREDECESSOR'S MOST EXPENSIVE INTERFACE DEFECT. A transparent
  // `pointer-events: auto` layer over the preview is the obvious build, and it
  // stops a 43-page document scrolling. Measured rather than reasoned about:
  // scroll with the pointer over the middle of the canvas, where every ring,
  // every wrapper and every would-be handle lives.
  const { eventUrl, editorUrl } = await createEvent(page, `Wheel Sale ${RUN}`);
  await importLots(page, eventUrl, 20);
  await page.goto(editorUrl);
  await expect(preview(page).locator(".page")).toHaveCount(5);

  const box = (await page.locator('iframe[title="Catalogue preview"]').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  // With something selected, so the rings are painted where the pointer is.
  const lotId = await preview(page).locator(".slot").first().getAttribute("data-lot");
  const title = await boxIn(page, `[data-lot="${lotId}"][data-field="title"]`);
  await page.mouse.click(title.x + title.w / 2, title.y + title.h / 2);
  await expect(page.locator('[data-ring-kind="selected"]')).toHaveCount(1);

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 900);
  await expect.poll(() => scrollOf(page)).toBeGreaterThan(400);
  // And no capture layer is left standing between gestures.
  await expect(page.locator("[data-capture]")).toHaveCount(0);
});

test("a part dropped on another lot says so, and the page still prints", async ({ page }) => {
  // THE ONE WAY A DRAG CAN SPOIL A PAGE IN SILENCE. Nothing is cut: the ink
  // underneath is painted first and then covered, so no clip mark fires, the
  // renderer has nothing to say, and the preview looks exactly like a spread
  // somebody composed on purpose. It reaches the printer that way.
  //
  // Deterministic rather than hopeful: the second lot's own title box is
  // measured and the first lot's title is dragged onto its centre, so the
  // intersection is the whole of the smaller box and cannot be a rounding
  // artefact of the viewport.
  const { eventUrl, editorUrl } = await createEvent(page, `Overlap Sale ${RUN}`);
  await importLots(page, eventUrl, 8);
  await page.goto(editorUrl);
  await expect(preview(page).locator(".page")).toHaveCount(2);

  const slots = preview(page).locator(".slot");
  const lotA = await slots.nth(0).getAttribute("data-lot");
  const lotB = await slots.nth(1).getAttribute("data-lot");
  expect(lotA).toBeTruthy();
  expect(lotB).toBeTruthy();
  expect(lotA).not.toBe(lotB);

  // Nothing to report before the gesture — the engine's own layout does not
  // overlap, and a mark on an untouched page would be noise on every sale.
  await expect(overlay(page)).toHaveAttribute("data-overlap-count", "0");

  const from = await boxIn(page, `[data-lot="${lotA}"][data-field="title"]`);
  const onto = await boxIn(page, `[data-lot="${lotB}"][data-field="title"]`);
  await page.mouse.move(from.x + from.w / 2, from.y + from.h / 2);
  await page.mouse.down();
  await page.mouse.move(onto.x + onto.w / 2, onto.y + onto.h / 2, { steps: 12 });
  await page.mouse.up();

  await expect.poll(() => storedFrame(page, lotA!, "title")).not.toBeNull();
  // AND THE PREVIEW HAS CAUGHT UP. `storedFrame` asks the server, which
  // answers as soon as the row is written; the overlay measures the DOCUMENT,
  // which does not exist until the back buffer has loaded and swapped. Polling
  // the mark without waiting for the part to be painted asks a question about
  // a page that is still the old one, and gets the honest answer nought.
  await expect(preview(page).locator('[data-frame-source="override"]')).toHaveCount(1);
  // It landed, and it is marked — one is no use without the other. The whole
  // point is that the commit SUCCEEDS and is reported: principle 9, a default
  // and not a lock, because a part over the next lot is sometimes what a
  // spread wants.
  await expect
    .poll(async () => Number(await overlay(page).getAttribute("data-overlap-count")))
    .toBeGreaterThan(0);
  await expect(page.locator("[data-overlay-note]")).toContainText("over another lot");
  await page.screenshot({ path: shot("84-place-overlap") });

  // AND IT IS NOT A CLIP. The two marks answer different questions and the
  // note says the one that costs somebody else's line; asserting this is what
  // stops the overlap being "fixed" by folding it into clipMarks.
  await expect(overlay(page)).toHaveAttribute("data-clip-count", "0");
});
