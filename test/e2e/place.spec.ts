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
//   data-handle        which of the eight grips this square is
//   data-guide         which axis an alignment line claims
//   data-toolbar-side  above, below, or pinned — the bar's own answer
//   data-placements    how many placements this sitting has to undo
//   data-capture-mode  which gesture the capture layer is serving
//
// Comparing a measured box against a re-derivation of the same arithmetic is
// how three of the predecessor's audits measured the wrong thing and
// confidently accused a correct fix; comparing it against an attribute the
// renderer published cannot make that mistake.
//
// Runs against the BUILT application and a real database, one worker.

import { expect, test, type FrameLocator, type Page } from "@playwright/test";

import { SNAP_PX } from "@/lib/editor/drag-geometry";

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
  // POLLED, because "the ring follows the pointer" is eventually true and this
  // sampled it once. The overlay measures at most once per painted frame — a
  // deliberate rule, since re-reading every box per event is what makes a
  // preview stutter — so a read taken straight after the last `mouse.move` can
  // land a frame early. Chromium usually got there first and WebKit usually
  // did not, which is how a timing assumption reads as an engine difference.
  // It still fails if the ring never moves: the poll has a deadline.
  await expect
    .poll(async () => (await page.locator('[data-ring-kind="selected"]').boundingBox())?.y ?? 0)
    .toBeGreaterThan(title.y + dy / 2);
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
  // WITHIN A SNAP OF WHAT THE POINTER ASKED, and the tolerance is the product's
  // own number rather than a round one. A drag now snaps to the page's and the
  // neighbours' edges and centres within `SNAP_PX`, so "where the pointer
  // asked" is the right expectation only to that accuracy — this landed 0.007
  // of the page above the raw position, which is one snap step on this sheet
  // and not a bug. A whole slot width is still the failure being watched for.
  const snapX = SNAP_PX / page1.w;
  const snapY = SNAP_PX / page1.h;
  expect(Math.abs(stored[0] - wantX)).toBeLessThanOrEqual(snapX + 0.002);
  expect(Math.abs(stored[1] - wantY)).toBeLessThanOrEqual(snapY + 0.002);
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

// ── Phase 4b: the handles, the arrows, the bar and the way back ──────────────

/** Select the first lot's title and return everything a gesture needs. */
async function selectTitle(
  page: Page,
): Promise<{ lotId: string; title: Box; page1: Box }> {
  const lotId = (await preview(page).locator(".slot").first().getAttribute("data-lot"))!;
  expect(lotId).toBeTruthy();
  const title = await boxIn(page, `[data-lot="${lotId}"][data-field="title"]`);
  const page1 = await boxIn(page, ".page");
  await page.mouse.click(title.x + title.w / 2, title.y + title.h / 2);
  await expect(overlay(page)).toHaveAttribute("data-selection", JSON.stringify([lotId, "title"]));
  return { lotId, title, page1 };
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

test("a handle resizes a part, and a box too small for its text says so", async ({ page }) => {
  // ── WHY A HANDLE IS NOT A SECOND DRAG ────────────────────────────────────
  // A move changes x and y; a resize changes w and h and leaves the opposite
  // edge exactly where it was. Both go through one converter on purpose
  // (`gestureFrame`), so the assertion worth making is the one a second
  // converter would break: the edge that was NOT dragged has not moved.
  //
  // And a resize is the gesture that actually creates a clipped box. A move
  // freezes the size and waits for the type scale to drift past it; a handle
  // cuts the last line immediately, with no fade on screen and none on paper,
  // because `.placed` carries `overflow: hidden` and the caption's own "there
  // is more" gradient is keyed to `.caption`, which a lifted part has left.
  const { eventUrl, editorUrl } = await createEvent(page, `Resize Sale ${RUN}`);
  await importLots(page, eventUrl, 8);
  await page.goto(editorUrl);
  await expect(preview(page).locator(".page")).toHaveCount(2);

  const { lotId, title, page1 } = await selectTitle(page);

  // ── EIGHT GRIPS, PAINTED, AND NONE OF THEM TAKES THE POINTER ─────────────
  await expect(page.locator("[data-handle]")).toHaveCount(8);
  await expect(overlay(page)).toHaveAttribute("data-handle-count", "8");
  await expect(page.locator('[data-handle="se"]')).toHaveAttribute(
    "data-handle-cursor",
    "nwse-resize",
  );

  // ── THE `se` HANDLE: WIDTH AND HEIGHT MOVE, x AND y DO NOT ───────────────
  const se = (await page.locator('[data-handle="se"]').boundingBox())!;
  const grip = { x: se.x + se.width / 2, y: se.y + se.height / 2 };
  const grow = Math.round(page1.w * 0.1);
  await page.mouse.move(grip.x, grip.y);
  await page.mouse.down();
  await page.mouse.move(grip.x + grow, grip.y + grow, { steps: 10 });
  // The capture layer says which gesture it is serving, and carries the only
  // cursor this layer can ever show — the overlay takes no pointer, so there
  // is no hover cursor to read.
  await expect(page.locator("[data-capture]")).toHaveAttribute("data-capture-mode", "se");
  await page.screenshot({ path: shot("85-resize-dragging") });
  await page.mouse.up();

  await expect.poll(() => storedFrame(page, lotId, "title")).not.toBeNull();
  const stored = (await storedFrame(page, lotId, "title"))!;
  const line =
    `resized to ${stored.map((n) => n.toFixed(4)).join(", ")} ` +
    `(was ${((title.x - page1.x) / page1.w).toFixed(4)}, ${((title.y - page1.y) / page1.h).toFixed(4)}, ` +
    `${(title.w / page1.w).toFixed(4)}, ${(title.h / page1.h).toFixed(4)})`;
  console.log(line);
  test.info().annotations.push({ type: "resize", description: line });
  // THE ANCHORED CORNER. Within a fifth of a percent of the page, the same
  // tolerance the drag uses and for the same reason: a hair of rounding is
  // expected, a slot width is the failure being watched for.
  expect(stored[0]).toBeCloseTo((title.x - page1.x) / page1.w, 2);
  expect(stored[1]).toBeCloseTo((title.y - page1.y) / page1.h, 2);
  // THE DRAGGED ONE. Grown by the pointer's travel, as a share of the page.
  expect(stored[2]).toBeCloseTo((title.w + grow) / page1.w, 2);
  expect(stored[3]).toBeCloseTo((title.h + grow) / page1.h, 2);
  await expect(page.getByText(/1 override/)).toBeVisible();
  await page.screenshot({ path: shot("86-resize-committed") });

  // ── SHRINK IT PAST ITS OWN INK, AND THE MARK FIRES ───────────────────────
  // Nothing was cut a moment ago and the count says so; this is the gesture
  // that makes the state, so the count must move because of it and not have
  // been standing at one all along.
  await expect(overlay(page)).toHaveAttribute("data-clip-count", "0");
  const s = (await page.locator('[data-handle="s"]').boundingBox())!;
  const bottom = { x: s.x + s.width / 2, y: s.y + s.height / 2 };
  await page.mouse.move(bottom.x, bottom.y);
  await page.mouse.down();
  // Up past the top of the box: `dragRect` stops at MIN_SIZE_PX rather than
  // turning the box inside out, so this is a resize to the floor.
  await page.mouse.move(bottom.x, bottom.y - (title.h + grow) * 2, { steps: 10 });
  await page.mouse.up();

  await expect
    .poll(async () => Number(await overlay(page).getAttribute("data-clip-count")))
    .toBeGreaterThan(0);
  await expect(page.locator("[data-clip]")).toHaveCount(1);
  // THE MARK IS THE SAYING; the note is one sentence for the whole overlay and
  // it is not always this one. Growing a part until its text is cut can also
  // put it over the lot below, and when both are true the OVERLAP speaks first
  // — deliberately, because a clipped box costs one field and a covered
  // neighbour costs somebody else's entry (preview-canvas.tsx says so at the
  // note). Asserting the sentence here made this test fail for the other
  // defect firing correctly.
  await expect(page.locator("[data-overlay-note]")).toContainText(
    /too small for its text|over another lot/,
  );
  const cut = Number(await page.locator("[data-clip]").getAttribute("data-clip-px"));
  const cutLine = `a handle cut ${cut}px of ink off ${lotId} title`;
  console.log(cutLine);
  test.info().annotations.push({ type: "clip", description: cutLine });
  expect(cut).toBeGreaterThan(0);
  await page.screenshot({ path: shot("87-resize-clipped") });

  // AND THE PAGE STILL PRINTS. A clipped box is reported, not refused —
  // principle 9, a default and not a lock.
  const pdf = await page.request.get(`${editorUrl}/pdf`);
  expect(pdf.ok()).toBe(true);
});

test("a gesture snaps to the page's own geometry, and says what it snapped to", async ({
  page,
}) => {
  // Snapping is invisible when it works and indistinguishable from a steady
  // hand when it does not, so the assertion is the GUIDE — the line the
  // overlay draws only when an edge genuinely coincides with something
  // (`guidesFor` recomputes from the final rectangle for exactly this reason).
  const { eventUrl, editorUrl } = await createEvent(page, `Snap Sale ${RUN}`);
  await importLots(page, eventUrl, 8);
  await page.goto(editorUrl);
  await expect(preview(page).locator(".page")).toHaveCount(2);

  const { title, page1 } = await selectTitle(page);
  await expect(overlay(page)).toHaveAttribute("data-guide-count", "0");

  // Aim the box's own left edge at the page's vertical centre and stop three
  // pixels short of it — inside SNAP_PX (6), outside DRAG_THRESHOLD_PX (3).
  const centre = page1.x + page1.w / 2;
  const from = { x: title.x + title.w / 2, y: title.y + title.h / 2 };
  const wantedLeft = centre - 3;
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + (wantedLeft - title.x), from.y + 40, { steps: 12 });

  await expect
    .poll(async () => Number(await overlay(page).getAttribute("data-guide-count")))
    .toBeGreaterThan(0);
  await expect(page.locator('[data-guide="x"]')).toHaveCount(1);
  const at = Number(await page.locator('[data-guide="x"]').getAttribute("data-guide-at"));
  const frameBox = (await page.locator('iframe[title="Catalogue preview"]').boundingBox())!;
  const guideLine = `guide at ${at} in the overlay, page centre at ${Math.round(centre - frameBox.x)}`;
  console.log(guideLine);
  test.info().annotations.push({ type: "snap", description: guideLine });
  // The overlay's coordinates are the frame's border box, so the page centre
  // in window coordinates has the frame's own left edge taken off it.
  expect(Math.abs(at - (centre - frameBox.x))).toBeLessThanOrEqual(1);
  await page.screenshot({ path: shot("88-snap-guide") });

  await page.mouse.up();
  // THE LINES GO WITH THE GESTURE. A guide left standing would be a claim
  // about a rectangle that is no longer being dragged.
  await expect.poll(async () => overlay(page).getAttribute("data-guide-count")).toBe("0");
});

test("the arrows nudge the selection, and leave the page alone when there is none", async ({
  page,
}) => {
  // ── THE BARE ARROW, AS DECIDED ───────────────────────────────────────────
  // A bare arrow means the SELECTION when there is one and the SALE when there
  // is not (src/components/preview-canvas.tsx and src/components/lot-steps.tsx
  // both carry the note). The editor's half is observable here twice over:
  // with something selected the key moves the part and does not scroll the
  // preview, and with nothing selected the key is not consumed at all, so the
  // browser's own default — scrolling the document — happens instead.
  const { eventUrl, editorUrl } = await createEvent(page, `Nudge Sale ${RUN}`);
  await importLots(page, eventUrl, 20);
  await page.goto(editorUrl);
  await expect(preview(page).locator(".page")).toHaveCount(5);

  // ── NOTHING SELECTED: THE KEY IS NOT OURS ────────────────────────────────
  const box = (await page.locator('iframe[title="Catalogue preview"]').boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + 8);
  await expect(overlay(page)).toHaveAttribute("data-selection", "");
  const resting = await scrollOf(page);
  await page.keyboard.press("ArrowDown");
  await expect.poll(() => scrollOf(page)).toBeGreaterThan(resting);
  await expect(overlay(page)).toHaveAttribute("data-placements", "0");

  // ── SOMETHING SELECTED: THE KEY IS OURS ──────────────────────────────────
  await preview(page).locator(".page").first().evaluate((el) => el.scrollIntoView());
  const { lotId, title, page1 } = await selectTitle(page);
  const held = await scrollOf(page);

  // Ten coarse presses — Shift is the step lot-steps.tsx never wanted, so this
  // half of the collision never existed — then ten fine ones.
  for (let i = 0; i < 10; i++) await page.keyboard.press("Shift+ArrowRight");
  for (let i = 0; i < 10; i++) await page.keyboard.press("ArrowDown");
  // THE PAGE DID NOT MOVE. `preventDefault` is called only once the nudge has
  // actually taken the key, and without it the preview scrolls a page while
  // the box moves a pixel.
  expect(Math.abs((await scrollOf(page)) - held)).toBeLessThan(2);

  // ── ONE SAVE PER PAUSE, NOT ONE PER PRESS ────────────────────────────────
  // Twenty presses. One POST each would re-derive the document and reload a
  // preview twenty times; the settle is what makes the run one decision, and
  // one decision is one undo entry.
  await expect.poll(() => storedFrame(page, lotId, "title")).not.toBeNull();
  await expect(overlay(page)).toHaveAttribute("data-placements", "1");
  await expect(page.getByText(/1 override/)).toBeVisible();

  const stored = (await storedFrame(page, lotId, "title"))!;
  const nudgeLine =
    `nudged to ${stored[0].toFixed(4)}, ${stored[1].toFixed(4)} ` +
    `(10 × Shift → right, 10 × down, from ${((title.x - page1.x) / page1.w).toFixed(4)}, ` +
    `${((title.y - page1.y) / page1.h).toFixed(4)})`;
  console.log(nudgeLine);
  test.info().annotations.push({ type: "nudge", description: nudgeLine });
  // NUDGE_COARSE_PX × 10 to the right and NUDGE_PX × 10 down, in screen
  // pixels, as fractions of the page. The units are the honest ones: the
  // specialist is looking at a screen and pressing a key to move what they see.
  expect(stored[0]).toBeCloseTo((title.x - page1.x + 100) / page1.w, 2);
  expect(stored[1]).toBeCloseTo((title.y - page1.y + 10) / page1.h, 2);
  // The size is untouched: an arrow moves a box, it does not resize one.
  expect(stored[2]).toBeCloseTo(title.w / page1.w, 2);
  expect(stored[3]).toBeCloseTo(title.h / page1.h, 2);
  await page.screenshot({ path: shot("89-nudge-committed") });
});

test("undo puts the last placement back, and reset hands the part to the engine", async ({
  page,
}) => {
  // ── UNDO IS IN-SESSION AND HONEST ABOUT IT ───────────────────────────────
  // The stack is one component's ref. Beneath it is Reset, which principle 9
  // requires regardless: an automatic or human correction the specialist
  // cannot reach is a defect however good the correction, and an in-session
  // stack cannot be the only way out of a placement made yesterday.
  const { eventUrl, editorUrl } = await createEvent(page, `Undo Sale ${RUN}`);
  await importLots(page, eventUrl, 8);
  await page.goto(editorUrl);
  await expect(preview(page).locator(".page")).toHaveCount(2);

  const { lotId, title } = await selectTitle(page);

  // ── THE BAR IS THERE, AND IT SAYS WHERE IT STOOD ─────────────────────────
  const bar = page.locator("[data-toolbar]");
  await expect(bar).toHaveCount(1);
  await expect(bar).toHaveAttribute("data-toolbar-side", /above|below|pinned/);
  // Nothing to undo and nothing to reset on a part the engine placed.
  await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Reset placement" })).toBeDisabled();
  await page.screenshot({ path: shot("90-toolbar-derived") });

  // ── PLACE IT ─────────────────────────────────────────────────────────────
  await page.mouse.move(title.x + title.w / 2, title.y + title.h / 2);
  await page.mouse.down();
  await page.mouse.move(title.x + title.w / 2 + 70, title.y + title.h / 2 + 50, { steps: 12 });
  await page.mouse.up();
  await expect.poll(() => storedFrame(page, lotId, "title")).not.toBeNull();
  await expect(overlay(page)).toHaveAttribute("data-placements", "1");
  const placed = (await storedFrame(page, lotId, "title"))!;

  // ── UNDO ─────────────────────────────────────────────────────────────────
  // This part's entry has a null `before` — the engine had placed it — so its
  // inverse is `{ frame: null }`, which is a real state with a real patch and
  // is the reason `before` is nullable rather than absent.
  await expect(page.getByRole("button", { name: "Undo" })).toBeEnabled();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect.poll(() => storedFrame(page, lotId, "title")).toBeNull();
  await expect(overlay(page)).toHaveAttribute("data-placements", "0");
  // The row went with the frame: it held nothing else.
  await expect(page.getByText(/override/)).toHaveCount(0);
  await expect(
    preview(page).locator(`[data-lot="${lotId}"][data-field="title"][data-frame-source="override"]`),
  ).toHaveCount(0);
  await page.screenshot({ path: shot("91-undone") });

  // ── PLACE IT TWICE, AND UNDO ONCE ────────────────────────────────────────
  // NO COALESCING: two drags are two decisions, so the first undo takes back
  // the second placement and lands on the FIRST — not on the engine.
  const again = await boxIn(page, `[data-lot="${lotId}"][data-field="title"]`);
  await page.mouse.move(again.x + again.w / 2, again.y + again.h / 2);
  await page.mouse.down();
  await page.mouse.move(again.x + again.w / 2 + 60, again.y + again.h / 2 + 30, { steps: 10 });
  await page.mouse.up();
  await expect.poll(() => storedFrame(page, lotId, "title")).not.toBeNull();
  const first = (await storedFrame(page, lotId, "title"))!;

  const moved = await boxIn(page, `[data-lot="${lotId}"][data-field="title"]`);
  await page.mouse.move(moved.x + moved.w / 2, moved.y + moved.h / 2);
  await page.mouse.down();
  await page.mouse.move(moved.x + moved.w / 2 + 40, moved.y + moved.h / 2 + 20, { steps: 10 });
  await page.mouse.up();
  await expect.poll(() => storedFrame(page, lotId, "title")).not.toEqual(first);
  await expect(overlay(page)).toHaveAttribute("data-placements", "2");

  await page.getByRole("button", { name: "Undo" }).click();
  await expect.poll(() => storedFrame(page, lotId, "title")).toEqual(first);
  await expect(overlay(page)).toHaveAttribute("data-placements", "1");
  const undoLine =
    `two placements, one undo: back to ${first.map((n) => n.toFixed(4)).join(", ")} ` +
    `(the first, not the engine — the engine's answer was ${placed.length} numbers ago)`;
  console.log(undoLine);
  test.info().annotations.push({ type: "undo", description: undoLine });

  // ── RESET, WHICH IS THE FLOOR UNDER ALL OF IT ────────────────────────────
  await page.getByRole("button", { name: "Reset placement" }).click();
  await expect.poll(() => storedFrame(page, lotId, "title")).toBeNull();
  await expect(page.getByText(/override/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Reset placement" })).toBeDisabled();
  await page.screenshot({ path: shot("92-reset") });
});

test("resetting one part does not throw away another lot's history", async ({ page }) => {
  // ── THE OVER-CORRECTION THIS EXISTS TO STOP ──────────────────────────────
  // A reset clears a frame, so any entry describing where THAT part used to be
  // is stale. `stillApplies` would catch it on the next undo and then clear
  // the WHOLE stack, because a verification failure means "somebody changed
  // this behind me and I cannot tell what else they touched". Here the editor
  // is the somebody and knows exactly which entries it invalidated, so it
  // takes those out itself — `forget` — and every other lot's undo survives.
  //
  // Throwing away an afternoon's history because one part was reset is the
  // kind of over-correction a person notices once and answers by never
  // pressing the button again.
  const { eventUrl, editorUrl } = await createEvent(page, `Forget Sale ${RUN}`);
  await importLots(page, eventUrl, 8);
  await page.goto(editorUrl);
  await expect(preview(page).locator(".page")).toHaveCount(2);

  const slots = preview(page).locator(".slot");
  const lotA = (await slots.nth(0).getAttribute("data-lot"))!;
  const lotB = (await slots.nth(1).getAttribute("data-lot"))!;
  expect(lotA).not.toBe(lotB);

  const drag = async (lotId: string, dx: number, dy: number): Promise<void> => {
    const box = await boxIn(page, `[data-lot="${lotId}"][data-field="title"]`);
    await page.mouse.move(box.x + box.w / 2, box.y + box.h / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.w / 2 + dx, box.y + box.h / 2 + dy, { steps: 10 });
    await page.mouse.up();
    await expect.poll(() => storedFrame(page, lotId, "title")).not.toBeNull();
  };

  await drag(lotB, 40, 30);
  await drag(lotA, 50, 40);
  await expect(overlay(page)).toHaveAttribute("data-placements", "2");

  // Reset A — which is selected, because dragging it selected it.
  await page.getByRole("button", { name: "Reset placement" }).click();
  await expect.poll(() => storedFrame(page, lotA, "title")).toBeNull();
  // A's entry went with its frame; B's did not.
  await expect(overlay(page)).toHaveAttribute("data-placements", "1");

  // AND THE SURVIVING ENTRY STILL WORKS — which is the whole claim. A stack
  // that merely kept its count and then failed verification on the next press
  // would be the same defect wearing a better number.
  await expect(page.getByRole("button", { name: "Undo" })).toBeEnabled();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect.poll(() => storedFrame(page, lotB, "title")).toBeNull();
  await expect(overlay(page)).toHaveAttribute("data-placements", "0");
  await expect(page.getByText(/override/)).toHaveCount(0);
});

test("the bar stands beside the selection and never on the artwork", async ({ page }) => {
  // ── WHAT IS MEASURED HERE, AND WHY IT IS MEASURED RATHER THAN REASONED ───
  // `toolbarSpot`'s rule depends on the page's own contents — where the
  // neighbouring boxes are, and therefore where there is empty paper — so
  // "did it stand above or below, and did it give up?" cannot be recovered
  // from a screenshot without re-deriving the arithmetic under test. The bar
  // publishes its answer; this reads it, and then checks the geometry agrees.
  //
  // It also prints the DESK: how much canvas there is on each side of the
  // sheet and above it, at both fits. That is the number that decides where
  // any persistent control may live over this canvas
  // (src/components/catalogue-workspace.tsx made the same measurement for the
  // settings column and got 236 / 236 / 16 at 1440×900 fit-page).
  const { eventUrl, editorUrl } = await createEvent(page, `Toolbar Sale ${RUN}`);
  await importLots(page, eventUrl, 8);
  await page.goto(editorUrl);
  await expect(preview(page).locator(".page")).toHaveCount(2);

  const canvas = (await page.locator('iframe[title="Catalogue preview"]').boundingBox())!;
  const desk = async (): Promise<string> => {
    const sheet = await boxIn(page, ".page");
    return (
      `left ${Math.round(sheet.x - canvas.x)}px · right ` +
      `${Math.round(canvas.x + canvas.width - (sheet.x + sheet.w))}px · top ` +
      `${Math.round(sheet.y - canvas.y)}px (canvas ${Math.round(canvas.width)}×${Math.round(canvas.height)})`
    );
  };
  const atPage = await desk();
  await page.getByLabel("Fit").selectOption("width");
  await expect.poll(async () => (await boxIn(page, ".page")).w).toBeGreaterThan(canvas.width - 80);
  const atWidth = await desk();
  await page.getByLabel("Fit").selectOption("page");
  await expect.poll(async () => (await boxIn(page, ".page")).w).toBeLessThan(canvas.width - 200);

  const deskLine = `desk at fit-page: ${atPage}; at fit-width: ${atWidth}`;
  console.log(deskLine);
  test.info().annotations.push({ type: "desk", description: deskLine });

  // ── THE BAR ──────────────────────────────────────────────────────────────
  const { title } = await selectTitle(page);
  const bar = page.locator("[data-toolbar]");
  const spot = (await bar.boundingBox())!;
  const side = await bar.getAttribute("data-toolbar-side");
  const barLine =
    `bar ${Math.round(spot.width)}×${Math.round(spot.height)} stood ${side} a ` +
    `${Math.round(title.w)}×${Math.round(title.h)} caption row`;
  console.log(barLine);
  test.info().annotations.push({ type: "toolbar", description: barLine });

  // OUTSIDE THE RING, whichever side it chose. This is the whole rule: the
  // thing behind the bar is a client's unpublished sale, and a bar sitting on
  // the artwork is worse than a bar in an awkward place.
  if (side === "above") expect(spot.y + spot.height).toBeLessThanOrEqual(title.y + 1);
  if (side === "below") expect(spot.y).toBeGreaterThanOrEqual(title.y + title.h - 1);
  // ON THE GLASS, always. A bar placed off the canvas is a control nobody can
  // reach, and one placed over the note at the canvas's foot is the collision
  // `CanvasView.reserveBottom` exists for.
  expect(spot.y).toBeGreaterThanOrEqual(canvas.y - 1);
  expect(spot.y + spot.height).toBeLessThanOrEqual(canvas.y + canvas.height + 1);
  expect(spot.x).toBeGreaterThanOrEqual(canvas.x - 1);
  await page.screenshot({ path: shot("93-toolbar-placed") });

  // ── IT GOES WITH THE SELECTION, AND WHILE A GESTURE RUNS ─────────────────
  await page.mouse.move(title.x + title.w / 2, title.y + title.h / 2);
  await page.mouse.down();
  await page.mouse.move(title.x + title.w / 2 + 60, title.y + title.h / 2 + 40, { steps: 8 });
  // A bar under the pointer mid-gesture is a patch of dead glass exactly where
  // the hand is — and it would be pointing at a rectangle about to be replaced.
  await expect(bar).toHaveCount(0);
  await page.mouse.up();
  await expect.poll(() => bar.count()).toBe(1);

  await page.keyboard.press("Escape");
  await expect(overlay(page)).toHaveAttribute("data-selection", "");
  await expect(bar).toHaveCount(0);
  await expect(page.locator("[data-handle]")).toHaveCount(0);
});

test("the overlay still never takes the wheel, with every 4b mark painted", async ({ page }) => {
  // THE 4a GUARANTEE, RE-ASKED OF THE LAYER 4b ADDED TO. Eight handles, a
  // guide and a floating bar are three new chances to reintroduce the
  // predecessor's most expensive interface defect, and the first two are
  // painted exactly where the pointer is. The bar is the ONE live thing on
  // this layer; it is a few hundred pixels of chrome rather than a layer, and
  // the wheel must still reach the preview everywhere else.
  const { eventUrl, editorUrl } = await createEvent(page, `Wheel 4b Sale ${RUN}`);
  await importLots(page, eventUrl, 20);
  await page.goto(editorUrl);
  await expect(preview(page).locator(".page")).toHaveCount(5);

  const { title } = await selectTitle(page);
  await expect(page.locator("[data-handle]")).toHaveCount(8);

  // Over a handle — a 9px square with a 16px hit box, and the place a live
  // element would be most tempting.
  const se = (await page.locator('[data-handle="se"]').boundingBox())!;
  await page.mouse.move(se.x + se.width / 2, se.y + se.height / 2);
  const before = await scrollOf(page);
  await page.mouse.wheel(0, 900);
  await expect.poll(() => scrollOf(page)).toBeGreaterThan(before + 400);

  // And over the middle of the selected part itself.
  await page.mouse.move(title.x + title.w / 2, title.y + title.h / 2);
  const mid = await scrollOf(page);
  await page.mouse.wheel(0, 600);
  await expect.poll(() => scrollOf(page)).toBeGreaterThan(mid + 200);

  // No capture layer is left standing between gestures.
  await expect(page.locator("[data-capture]")).toHaveCount(0);
});
