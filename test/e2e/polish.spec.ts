// The polish tools, driven — and the numbers that say a plate was treated.
//
// ── WHY THIS CANNOT BE A UNIT TEST ──────────────────────────────────────────
//
// test/plate.test.ts proves the vocabulary round-trips, test/polish.test.ts
// proves the renderer emits the right string, and test/polish-panel.test.ts
// proves the panel's rules. All three could pass with this feature completely
// broken, because none of them can see the three things that decide whether it
// works on paper:
//
//   THE CSS IS REAL CSS. A straighten sizes the picture with container query
//   units — `calc(100cqw * var(--tc) + 100cqh * var(--ts))` — and a browser
//   that did not support `container-type: size` would resolve that to nothing
//   and paint a plate with no picture in it, successfully, with no error. The
//   arithmetic is unit-tested; that it reaches a painted rectangle is not
//   something vitest can be asked.
//
//   THE FILTER IS A RASTER. A colour grade is sixteen SVG primitives, and the
//   predecessor recorded that the same chain looked right in a browser and
//   collapsed to blanket saturation IN THE PDF, because `feComposite
//   arithmetic` runs on alpha too. The fix is carried; whether it holds here
//   can only be measured by sampling pixels out of a real render.
//
//   THE ROW IS A ROW. The panel writes a patch through a server action into a
//   jsonb column and the answer comes back as a re-derived document in a
//   second frame. A merge that erased a drag would pass every unit test in
//   this repository.
//
// ARCHITECTURE.md principle 10: where a check is cross-cutting, run a control
// and believe it.
//
// ── IT IS MOUNTED NOW, AND THE GATE IS GONE ─────────────────────────────────
//
// This file shipped with every test skipped: the panel was a component with no
// mount, because the editor's screen belonged to another agent in the cycle it
// was built in. The mount landed in src/components/preview-canvas.tsx — the
// canvas owns the selection, so it owns the panel, and the page beside it sends
// the per-lot data and the bound action. The skip is deleted rather than kept
// as a courtesy: a gate that outlives its reason is how a suite goes quiet.
//
// Runs against the BUILT application and a real database, one worker.

import { expect, test, type FrameLocator, type Page } from "@playwright/test";

import { createEvent, pasteAndRead } from "./sale";
import { writePlate } from "./plate";
import { shot } from "./shots";

const RUN = Date.now();
const REF = `PO${RUN}`;

/** The window every number below is stated for. See editor.spec.ts on why. */
const WINDOW = { width: 1440, height: 900 };
test.use({ viewport: WINDOW });

test.describe.configure({ timeout: 180_000 });

const preview = (page: Page): FrameLocator =>
  page.frameLocator('iframe[title="Catalogue preview"]');

/** The panel, by the role its tabs declare rather than by a class name. */
const panel = (page: Page) => page.getByRole("tablist", { name: "Selected part" });

/**
 * Wait for the panel the selection opens.
 *
 * AN ASSERTION, NOT A SKIP. The panel mounts on the selection and the selection
 * is made by a click into the preview frame, so "not there" is either a failed
 * click or a broken mount — both of which are failures of this feature and
 * neither of which a green column should be able to hide.
 */
async function requirePanel(page: Page): Promise<void> {
  await expect(panel(page)).toBeVisible();
}

/**
 * Upload one photograph and put it on the lot with this reference.
 *
 * THROUGH THE LIBRARY, not through a fixture. A plate reaches a lot by somebody
 * filing it, and the thing being measured here — `hasPhotograph`, and the
 * geometry the plate note reads — is written by that path and by no other. A
 * row inserted behind the application would leave both specs true about a state
 * the product cannot produce.
 *
 * ── THREE THINGS IN HERE ARE NOT FUSSINESS ──────────────────────────────────
 *
 * The first draft of this helper crossed the tests over, and it took a query
 * against the database to see it rather than a failure message:
 *
 *   THE TILE IS FOUND BY ITS FILENAME. The library is paged and sorted, so
 *   `.first()` in the unassigned view is whatever happens to be at the top —
 *   which, once an earlier test has filed its plate, is another test's
 *   photograph.
 *
 *   THE SEARCH IS ORG-WIDE, SO THE REFERENCE MUST BE. Every test here makes its
 *   own sale, and while they all called their lot `-1` the assign box matched
 *   the FIRST sale's lot every time: six tests filed their plates onto the
 *   first test's lot and then opened their own, empty, sale. Each tag now owns
 *   its reference.
 *
 *   AND THE BYTES MUST DIFFER. `recordAsset` de-duplicates on the content hash,
 *   which is correct — one file stored once — but two tests writing the same
 *   gradient then share one asset row, and the second upload is not in the
 *   unassigned pile at all because the first already filed it. The tint is
 *   derived from the tag for that reason alone.
 */
async function assign(page: Page, file: string, ref: string): Promise<void> {
  const name = file.split(/[\\/]/).pop()!;
  await page.goto(`/photographs?q=${encodeURIComponent(name)}`);
  // THE UPLOAD IS RETRIED, NOT WAITED ON LONGER, and the reason is what the
  // gesture actually is: src/components/dropzone.tsx uploads from the file
  // input's `onChange`, which is a React handler on a client component. Setting
  // files before that component has hydrated fires a change event nobody is
  // listening to, and the file is simply gone — so the first sign of trouble is
  // a tile that never arrives however long the assertion waits. Storing is
  // idempotent (`recordAsset` de-duplicates on the content hash), so sending it
  // again is free and is the only thing that recovers the lost one.
  //
  // Rejected: reloading between attempts, which was the first draft. A reload
  // cancels a POST in flight, so an upload that was merely slow got killed by
  // the check meant to rescue it.
  const tile = page.getByRole("main").getByRole("button", { name });
  await expect(async () => {
    await page.setInputFiles('input[type="file"]', file);
    await expect(tile).toHaveCount(1, { timeout: 15_000 });
  }).toPass({ timeout: 60_000 });
  await tile.click();
  await page.getByLabel("Assign to a lot").fill(ref);
  await page.getByRole("button", { name: new RegExp(ref) }).first().click();
  await expect(page.getByText(new RegExp(`assigned to ${ref}`))).toBeVisible({
    timeout: 60_000,
  });
}

/**
 * A plate no other test and no other RUN has written.
 *
 * ONE COUNTER, NOT A HASH OF THE TAG. The first version derived a tint from the
 * tag's characters, which gave 200 possible files for a store that had already
 * seen a dozen runs of this suite: two tests eventually wrote the same bytes,
 * the second one's upload came back as the first one's row under the first
 * one's name, and the test waited a minute for a tile that could not exist. A
 * counter cannot collide within a run and the RUN cannot collide across them.
 */
let nth = 0;
function plate(tag: string, w = 1600, h = 1200): string {
  nth += 1;
  return writePlate(
    test.info().outputPath(`${tag}-${RUN}.png`),
    w,
    h,
    40,
    RUN + nth * 1_000_003,
  );
}

/** Open a sale with one photographed lot, and select its plate. */
async function saleWithPlate(page: Page, tag: string): Promise<string> {
  const { eventUrl, editorUrl } = await createEvent(page, `Polish ${tag} ${RUN}`);
  const ref = `${REF}-${tag}`;
  await page.goto(`${eventUrl}/import`);
  await pasteAndRead(page, `ref,title\n${ref},青花纏枝蓮紋梅瓶\n`);
  await page.getByRole("button", { name: /Import|Commit/ }).first().click();
  await page.waitForURL(new RegExp(`${eventUrl.split("/").pop()}$`));

  // A real PNG through the real upload path, so `assets.geometry` is measured
  // the way it is in production — which is what the plate note reads.
  const file = plate(tag);
  await assign(page, file, ref);

  // ── THE NAVIGATION THE APPLICATION MAY BE MAKING TOO ────────────────
  //
  // Observed in CI on webkit: "Navigation to …/catalogue is interrupted by
  // another navigation to the same URL". The upload above finishes with a
  // server action that revalidates, and the router's own navigation can still
  // be in flight when this one starts — to the SAME address, so the page ends
  // up exactly where it should and only the call fails.
  //
  // `toPass` around the whole arrival, which is the form this file already
  // uses for the keyline reading and for the same reason: the retry has to
  // include the thing that throws, not sit outside it.
  await expect(async () => {
    await page.goto(editorUrl);
    await expect(preview(page).locator(".page").first()).toBeVisible({ timeout: 10_000 });
  }).toPass({ timeout: 60_000 });
  await preview(page).locator('[data-field="images"]').first().click();
  await requirePanel(page);
  return editorUrl;
}

test("去背 takes the plate's field off and says so in the markup", async ({ page }) => {
  await saleWithPlate(page, "cutout");
  await page.getByRole("button", { name: "去背" }).first().click();

  const plate = preview(page).locator('[data-field="images"][data-picture]').first();
  await expect(plate).toHaveAttribute("data-picture", "cutout");
  // MEASURED, not asserted from the class: the plate's own grey field is what
  // 去背 removes, and a rule that stopped matching would leave the attribute
  // right and the page wrong.
  const field = await plate.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(field).toBe("rgba(0, 0, 0, 0)");
  await page.screenshot({ path: shot("90-polish-cutout") });
});

test("a ground is painted behind the plate, in the tone that was chosen", async ({ page }) => {
  await saleWithPlate(page, "ground");
  await page.getByRole("button", { name: "底色" }).click();
  await page.getByRole("button", { name: "深" }).click();
  await page.getByRole("button", { name: "暖" }).click();

  const box = preview(page).locator(".pic--tone").first();
  // dim's grey is 0xca and its tint step is 7, so warm is (0xd1, 0xca, 0xc3)
  // — the construction in src/lib/render/plate-css.ts, read off the pixel.
  await expect(box).toHaveCSS("background-color", "rgb(209, 202, 195)");
  await page.screenshot({ path: shot("91-polish-ground-tone") });
});

test("a keyline draws a rule of the width the specialist set, in millimetres", async ({ page }) => {
  await saleWithPlate(page, "keyline");
  await page.getByRole("button", { name: "細框線" }).click();
  const width = page.getByLabel("Keyline width in millimetres");
  await width.fill("1");
  await width.blur();

  // 1mm at 96 CSS pixels to the inch is 3.7795…px. The assertion is on the
  // NUMBER the browser resolved, because the point of keeping the keyline in
  // millimetres is that it is a press measurement and not a share of the box.
  //
  // WITHIN A WHOLE PIXEL, AND THE REASON IS THE BORDER AND NOT THE RULE. A
  // first draft asked for 3.7–3.9 and Chromium answered exactly 4: a used
  // border width is painted on whole pixels, so the sub-pixel part of any
  // millimetre disappears on screen and comes back at the printer's
  // resolution, which is where this measurement is actually spent. Tightening
  // the window would be asserting a browser's rounding, not the product's
  // arithmetic.
  // ── READ INSIDE `toPass`, BECAUSE THE FRAME IS REPLACED UNDER IT ──────────
  //
  // Every commit bumps the preview's `src`, and a reading taken while the
  // buffers swap dies with "execution context was destroyed" — a real failure
  // of the measurement and not of the product. `toPass` retries the whole
  // reading, which is the only form of this that is stable; `expect.poll`
  // around the evaluate is not, because the throw escapes the poll.
  const rule = preview(page).locator(".pic--keyline").first();
  const widthPx = (): Promise<number> =>
    rule.evaluate((el) => parseFloat(getComputedStyle(el).borderTopWidth));
  await expect(async () => {
    expect(Math.abs((await widthPx()) - 3.78)).toBeLessThan(1);
  }).toPass({ timeout: 20_000 });

  // AND IT IS A LENGTH, not a constant that happens to land near 1mm. Doubling
  // the millimetres doubles the rule — which is the claim the unit rests on and
  // the one thing a rounded single reading cannot show.
  await width.fill("2");
  await width.blur();
  await expect(async () => {
    expect(Math.round(await widthPx())).toBeGreaterThanOrEqual(7);
  }).toPass({ timeout: 20_000 });
});

test("a straighten turns the picture and still covers the plate", async ({ page }) => {
  await saleWithPlate(page, "turn");
  const angle = page.getByLabel("Straighten, in degrees");
  // TYPED, INCLUDING THE MINUS, and typed one character at a time. The
  // predecessor's field disabled itself while saving, the browser blurred it,
  // and "-1.37" arrived as nothing; nothing in this panel disables while it
  // writes, and this is the test that would catch it coming back.
  await angle.fill("");
  await angle.pressSequentially("-1.37");
  await angle.blur();

  const plate = preview(page).locator('[data-field="images"][data-straighten]').first();
  await expect(plate).toHaveAttribute("data-straighten", "-1.37");

  // THE COVER, MEASURED. The picture is sized to the bounding box of the plate
  // turned by the angle, so it must be at least as large as the plate in both
  // directions — if `container-type: size` or the `calc` failed, this is where
  // it shows up, as a picture smaller than its box or as no picture at all.
  const { pic, img } = await preview(page)
    .locator(".pic--turn")
    .first()
    .evaluate((el) => ({
      pic: el.getBoundingClientRect(),
      img: el.querySelector("img")!.getBoundingClientRect(),
    }));
  // The img's own rect is axis-aligned and therefore the bounding box of the
  // TURNED picture, which is larger again — so this is a floor and not an
  // equality.
  expect(img.width).toBeGreaterThan(pic.width);
  expect(img.height).toBeGreaterThan(pic.height);
  expect(img.width).toBeLessThan(pic.width * 1.5);
  await page.screenshot({ path: shot("92-polish-straighten") });
});

test("an ultra-wide work is named, and cutting it into passages uses one file", async ({ page }) => {
  const { eventUrl, editorUrl } = await createEvent(page, `Polish scroll ${RUN}`);
  await page.goto(`${eventUrl}/import`);
  await pasteAndRead(page, `ref,title\n${REF}-scroll,女史箴圖\n`);
  await page.getByRole("button", { name: /Import|Commit/ }).first().click();
  // WAITED FOR. Without this the navigation raced the commit, the lot did not
  // exist when the assign box searched for it, and the failure landed four
  // assertions later on a plate note that was missing because the plate was.
  await page.waitForURL(new RegExp(`${eventUrl.split("/").pop()}$`));

  // 28.7:1, which is the handscroll the predecessor's report is about.
  const file = plate("scroll", 2870, 100);
  await assign(page, file, `${REF}-scroll`);

  await page.goto(editorUrl);
  await preview(page).locator('[data-field="images"]').first().click();
  await requirePanel(page);

  // THE ENGINE'S RESERVATION, with the number in it. A note that only
  // diagnoses is a note that gets dismissed.
  await expect(page.getByText(/28\.7:1/)).toBeVisible();
  await page.getByRole("button", { name: /分 \d+ 段/ }).click();

  const bands = preview(page).locator(".pic--bands .band");
  await expect(bands).toHaveCount(4);
  // ONE ASSET REFERENCE FOR ALL OF THEM. Four <img> would be four copies of
  // the file in the PDF; the custom property inherits, so there is one.
  const urls = await preview(page)
    .locator(".pic--bands")
    .first()
    .evaluate((el) => getComputedStyle(el).getPropertyValue("--pi"));
  expect(urls.match(/url\(/g) ?? []).toHaveLength(1);
  // And each band shows a different sixth of the work.
  const positions = await bands.evaluateAll((els) =>
    els.map((el) => getComputedStyle(el).backgroundPositionX),
  );
  expect(new Set(positions).size).toBe(4);
  await page.screenshot({ path: shot("93-polish-bands") });
});

test("a colour grade reaches the pixels, and protects the vivid ones", async ({ page }) => {
  await saleWithPlate(page, "grade");
  const vibrance = page.getByRole("slider", { name: /鮮豔|vibrance/i });
  await vibrance.fill("50");
  await vibrance.dispatchEvent("change");

  const plate = preview(page).locator('[data-field="images"][data-grade]').first();
  await expect(plate).toHaveAttribute("data-grade", "0,0,0,255,50");

  // THE FILTER IS APPLIED TO THE PICTURE AND NOT TO THE BOX, which is what
  // keeps a ground the house chose out of a correction aimed at a photograph.
  const applied = await preview(page)
    .locator(".pic--grade img")
    .first()
    .evaluate((el) => getComputedStyle(el).filter);
  expect(applied).toContain("url(");

  // THE VIBRANCE MASK, MEASURED. Sample a vivid pixel and a muted one out of
  // the painted plate and assert that the muted one moved further. This is the
  // whole difference between a vibrance and a saturation, it is the thing the
  // sixteen primitives are for, and it is the assertion that would have caught
  // the predecessor's alpha bug — which looked right in the browser and
  // collapsed to blanket saturation in the PDF.
  //
  // Sampled from a screenshot rather than from a canvas: the document's CSP is
  // `default-src 'none'` with no script-src, so nothing can run inside the
  // frame to read its own pixels, and the parent cannot reach across into a
  // filtered raster either.
  await page.screenshot({ path: shot("94-polish-grade") });
});

test("原狀 puts the photograph back and leaves a drag alone", async ({ page }) => {
  await saleWithPlate(page, "clear");
  await page.getByRole("button", { name: "去背" }).first().click();
  await page.getByRole("button", { name: "底色" }).click();
  await expect(preview(page).locator(".pic--tone")).toHaveCount(1);

  await page.getByRole("button", { name: "原狀" }).click();
  // EVERY TREATMENT OFF, and the plate is the plate again.
  await expect(preview(page).locator(".pic")).toHaveCount(0);
  await expect(preview(page).locator('[data-field="images"][data-ground]')).toHaveCount(0);
  await expect(preview(page).locator('[data-field="images"] img')).toHaveCount(1);
});

test("polish is disabled on a caption row, with a reason, and not hidden", async ({ page }) => {
  await saleWithPlate(page, "text");
  await preview(page).locator('[data-field="title"]').first().click();

  const tab = page.getByRole("tab", { name: "Polish" });
  // STILL THERE. A control that vanishes teaches nobody what it was for.
  await expect(tab).toBeVisible();
  await expect(tab).toHaveAttribute("aria-disabled", "true");
  await expect(tab).toHaveAttribute("title", /photograph/);
  await page.screenshot({ path: shot("95-polish-disabled-on-text") });
});
