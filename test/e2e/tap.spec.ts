// The floor a finger needs, measured under a coarse pointer — and the floor a
// mouse needs, measured under a fine one, so the first cannot be paid for by
// the second.
//
// ── WHY THIS IS NOT ANSWERED BY THE UNIT CENSUS ──────────────────────────────
//
// test/house-style.test.ts counts class names, and a class name is a promise
// rather than a pixel. It cannot tell a 44px box from a 44px box behind
// something else, it cannot see a control the cascade has already made big
// enough by other means, and — the one that matters most here — it cannot see
// two targets OVERLAPPING. Each lot row in the lots panel holds two different
// gestures, tick it for a pin and open it to correct it, and the cheap way to
// give the tick its floor is to wrap the row in the label; that passes the
// census and makes the row worse than it was, because a finger aimed at the
// lot ticks it instead. Only a browser can say where the boxes are.
//
// ── THE EMULATION IS ASSERTED, NOT ASSUMED ───────────────────────────────────
//
// The whole measurement is conditional on `@media (pointer: coarse)` matching,
// and an emulation that silently did not take would make every assertion below
// pass against the 28px floor while claiming to have proved the 44px one. So
// each test first asks the page what it thinks it is: whether the media query
// matches, and what `--tap` actually resolves to. editor.spec.ts learned the
// same lesson about a viewport it had been told it had and did not.
//
// ── NOT IN CI, AND NOT CLAIMING TO BE ────────────────────────────────────────
//
// Like the rest of test/e2e, this is a control a person runs
// (`npm run test:e2e`), not a gate. .github/workflows/ci.yml runs migrate,
// typecheck, lint, vitest and build, and Playwright is in none of it.

import { expect, test, type Locator, type Page } from "@playwright/test";

import { createEvent } from "./sale";
import { shot } from "./shots";

const RUN = Date.now();
const REF = `T${RUN}`;
const ref = (n: number): string => `${REF}-${n}`;

/**
 * Sixteen lots, because the lots panel's rows are where this defect was
 * densest and where the fix costs the most height: a floor that is right on
 * one row can still be wrong on sixteen of them.
 */
const LOTS = 16;

/**
 * A tablet held in landscape, which is what a condition check in a warehouse
 * is done on (DFD.md §1). The size is not the point — `--tap` lifts on the
 * POINTER and not on a width, deliberately (globals.css) — but a window this
 * wide keeps the editor in its docked-settings shape, so the measurement is of
 * the layout a specialist actually meets rather than of the narrow fallback.
 */
const TABLET = { width: 1180, height: 820 };

/** What a page says about itself, so the emulation cannot fail silently. */
async function pointerReading(page: Page): Promise<{ coarse: boolean; tap: string }> {
  return page.evaluate(() => ({
    coarse: window.matchMedia("(pointer: coarse)").matches,
    tap: getComputedStyle(document.documentElement).getPropertyValue("--tap").trim(),
  }));
}

interface Box {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** The enclosing <label>'s box, when there is one. See `targets`. */
  labelBox?: { x: number; y: number; width: number; height: number } | null;
}

/**
 * Every control on the screen that a person can actually reach, with its box.
 *
 * REACHABLE, not merely present. `hidden` takes the rail and the lots panel
 * out of the accessibility tree and the tab order together (shell.tsx,
 * catalogue-workspace.tsx say why they are kept in the DOM), and a control
 * nobody can press is not a control that is too small. `:disabled` is kept —
 * a disabled density select still occupies the row and still has to look like
 * the ones beside it.
 */
async function controls(page: Page): Promise<Box[]> {
  const handles = await page
    .locator(
      [
        "main button",
        "main a[href]",
        "main select",
        "main textarea",
        "main input:not([type=hidden])",
      ].join(", "),
    )
    .all();
  const out: Box[] = [];
  for (const handle of handles) {
    if (!(await handle.isVisible())) continue;
    const box = await handle.boundingBox();
    if (!box) continue;
    const labelBox = await handle.evaluate((el) => {
      const label = el.closest("label");
      if (!label) return null;
      const r = label.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    });
    out.push({ ...box, name: await describe(handle), labelBox });
  }
  return out;
}

/** Enough to find the control again in the source, printed on a failure. */
async function describe(handle: Locator): Promise<string> {
  return handle.evaluate((el) => {
    const tag = el.tagName.toLowerCase();
    const type = el.getAttribute("type");
    const name =
      el.getAttribute("aria-label") ??
      el.getAttribute("name") ??
      (el.textContent ?? "").trim().slice(0, 40);
    return `${tag}${type ? `[${type}]` : ""} “${name}”`;
  });
}

/**
 * A checkbox is excused by ITS LABEL, so the box that has to clear the floor
 * is the label's and not the 13×13 square the browser paints.
 *
 * The substitution is done here rather than in the caller because it is the
 * definition of the measurement, not a detail of one assertion: "how big is
 * this checkbox" is the wrong question, and a helper that answers it honestly
 * would report every tick in the product as a failure.
 */
async function targets(page: Page): Promise<Box[]> {
  const boxes = await controls(page);
  const out: Box[] = [];
  for (const box of boxes) {
    if (!box.name.startsWith("input[checkbox]") && !box.name.startsWith("input[radio]")) {
      out.push(box);
      continue;
    }
    // THE DOM, NOT THE ACCESSIBLE NAME. The first version looked the label up
    // by `[aria-label="…"]`, which finds nothing for a checkbox whose label is
    // a wrapping <label> with a <span> of words in it — the commonest shape in
    // this product and the exact one the unit census excuses. It then fell
    // back to the 13×13 square and reported it as a failure, which is the
    // helper answering the question its own docstring says is the wrong one.
    out.push(box.labelBox ? { ...box.labelBox, name: `${box.name} (via its label)` } : box);
  }
  return out;
}

/** Make the sale this file measures, and land in its editor. */
async function seed(page: Page): Promise<string> {
  const { eventUrl } = await createEvent(page, `Tap Sale ${RUN}`);
  await page.getByRole("link", { name: "Import lots" }).first().click();
  await page
    .locator("textarea")
    .first()
    .fill(
      `編號\t品名\t作者\n` +
        Array.from({ length: LOTS }, (_, i) => `${ref(i + 1)}\t青花梅瓶 ${i + 1}\t佚名`).join("\n"),
    );
  await page.getByRole("button", { name: "Read this text" }).click();
  await page.getByRole("button", { name: new RegExp(`Import ${LOTS} lots`) }).click();
  await page.waitForURL(eventUrl);
  await page.locator("main").getByRole("link", { name: "Catalogue" }).click();
  await expect(page.getByRole("heading", { name: "Catalogue" })).toBeVisible();
  return `${eventUrl}/catalogue`;
}

test.describe.configure({ timeout: 180_000 });

test.describe("under a coarse pointer", () => {
  test.use({ viewport: TABLET, hasTouch: true, isMobile: true });

  test("every control on the editor clears --tap, and the two in a lot row do not overlap", async ({
    page,
  }) => {
    const editorUrl = await seed(page);

    // ── The emulation, before anything is believed about it ────────────────
    const reading = await pointerReading(page);
    expect(reading.coarse, "the coarse-pointer emulation did not take").toBe(true);
    // 44 is written here ONCE, as the thing the token is expected to resolve
    // to under this query — the product never names it, and that is the rule
    // the unit census holds. If globals.css changes the coarse value, this
    // line is the one edit and the rest of the file follows it.
    expect(reading.tap).toBe("44px");
    const floor = Number.parseInt(reading.tap, 10);

    await expect(page.getByRole("complementary", { name: "Lots in this catalogue" })).toBeVisible();
    await page.screenshot({ path: shot("80-editor-coarse"), fullPage: false });

    // ── Every reachable control ────────────────────────────────────────────
    const measured = await targets(page);
    // A count, so a selector that quietly stopped matching cannot pass as a
    // clean screen. Sixteen lot rows carry two controls each.
    expect(measured.length).toBeGreaterThanOrEqual(LOTS * 2);
    const small = measured
      .filter((box) => box.height < floor)
      .map((box) => `${box.name} is ${Math.round(box.width)}×${Math.round(box.height)}`);
    expect(small, `under ${floor}px on /events/[id]/catalogue`).toEqual([]);

    // A tick is small in BOTH directions, and a 44×13 target is still a miss.
    const narrow = measured
      .filter((box) => box.name.includes("via its label") && box.width < floor)
      .map((box) => `${box.name} is ${Math.round(box.width)}px wide`);
    expect(narrow).toEqual([]);

    // ── The two targets in a lot row are side by side, never stacked ───────
    const row = page
      .getByRole("complementary", { name: "Lots in this catalogue" })
      .locator("li")
      .filter({ hasText: ref(1) })
      .first();
    const tick = await row.locator("label").first().boundingBox();
    const open = await row.getByRole("link").first().boundingBox();
    expect(tick).not.toBeNull();
    expect(open).not.toBeNull();
    // Horizontally disjoint: the tick's right edge is at or before the link's
    // left edge. Two overlapping targets are worse than one small one, because
    // the small one at least fails visibly.
    expect(tick!.x + tick!.width).toBeLessThanOrEqual(open!.x + 0.5);

    // ── And the same on the lot form behind it ─────────────────────────────
    await row.getByRole("link").first().click();
    await page.waitForURL(/\/lots\//);
    await expect(page.getByRole("button", { name: "Save fields" })).toBeVisible();
    await page.screenshot({ path: shot("81-lot-coarse"), fullPage: true });
    const onLot = (await targets(page))
      .filter((box) => box.height < floor)
      .map((box) => `${box.name} is ${Math.round(box.width)}×${Math.round(box.height)}`);
    expect(onLot, `under ${floor}px on /events/[id]/lots/[lotId]`).toEqual([]);

    // Back, so the URL this measured is on the record of what was measured.
    await page.goto(editorUrl);
  });
});

test.describe("with a precise pointer", () => {
  test("the floor is the smaller token, and the page keeps the window it had", async ({ page }) => {
    await seed(page);

    const reading = await pointerReading(page);
    expect(reading.coarse, "a desktop project reported a coarse pointer").toBe(false);
    expect(reading.tap).toBe("28px");
    const floor = Number.parseInt(reading.tap, 10);

    // THE POINT OF THIS HALF. A 44px row on a dense editor toolbar costs
    // vertical space the page is measured in, and at fit-page the sheet is
    // sized by HEIGHT, so its AREA falls with the SQUARE of anything taken off
    // the top (catalogue-workspace.tsx carries that arithmetic). So the mouse
    // case is held to the SMALLER token: every control clears 28, and none of
    // them is the 44 that would mean a hard-coded number had crept in.
    const measured = await targets(page);
    const small = measured
      .filter((box) => box.height < floor)
      .map((box) => `${box.name} is ${Math.round(box.height)}px`);
    expect(small).toEqual([]);

    // Not a ceiling on every control — a textarea is three rows tall and the
    // preview's own chrome is not a toolbar button — but on the editor's
    // header row, which is the one the page's share is measured against.
    const lots = await page.getByRole("button", { name: /^Lots$/ }).boundingBox();
    expect(lots).not.toBeNull();
    expect(lots!.height).toBe(floor);
  });
});
