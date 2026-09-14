// The demo script, driven.
//
// ARCHITECTURE.md principle 10: measure, don't assert. Roughly two dozen defects
// in the predecessor were found by driving the application and none of them by
// its unit suite — so this walks the six steps of M1.md §1 in one sitting, on the
// fixture, and captures a screenshot at each. The screenshots are the artefact
// that says the interface exists; "the tests pass" does not.
//
// It runs against the BUILT application, and it writes to a real database.

import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

const SHOTS = join("test", "e2e", "screens");
mkdirSync(SHOTS, { recursive: true });

const shot = (name: string): string => join(SHOTS, `${name}.png`);

// A name unique per run: the suite writes real rows, and a fixed name would make
// the second run ambiguous about which event it was looking at.
const EVENT = `Spring Sale ${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "")}`;

test("the pitch, end to end", async ({ page }) => {
  // ── 1. The shell is the landing ─────────────────────────────────────────
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Events" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Events" })).toBeVisible();
  await page.screenshot({ path: shot("01-events"), fullPage: true });

  // ── 2. Create an event → an empty editor ────────────────────────────────
  await page.getByLabel("Event name").fill(EVENT);
  await page.getByLabel("Date held, if known").fill("2026-04-12");
  await page.getByRole("button", { name: "Create event" }).click();

  await expect(page.getByRole("heading", { name: EVENT })).toBeVisible();
  await expect(page.getByText("This event has no lots.")).toBeVisible();
  await page.screenshot({ path: shot("02-event-empty"), fullPage: true });

  const eventUrl = page.url();

  // ── 3. Import whatever the client brought ───────────────────────────────
  await page.getByRole("link", { name: "Import lots" }).first().click();
  await expect(page.getByRole("heading", { name: "Import lots" })).toBeVisible();
  await page.screenshot({ path: shot("03-import-choose"), fullPage: true });

  await page
    .locator('input[type="file"]')
    .setInputFiles(join("test", "fixtures", "spring-sale.csv"));

  // ── 4. Field matching ───────────────────────────────────────────────────
  await expect(page.getByRole("heading", { name: /Match \d+ columns/ })).toBeVisible();

  // The fixture opens with a three-row title block. Finding the header beneath
  // it is the difference between ten lots and a file full of columns called
  // "Column 1" — so it is asserted, not eyeballed.
  await expect(page.getByText(/Headers were found on row 4/)).toBeVisible();

  // The suggestion actually landed on the right field. 拍品編號 is a known
  // spelling of `ref`, and a mapping screen that suggests nothing is a mapping
  // screen that has made the specialist read every column.
  await expect(page.getByLabel("What 拍品編號 becomes")).toHaveValue("core:ref");
  await expect(page.getByLabel("What 品名 becomes")).toHaveValue("core:title");
  await expect(page.getByLabel("What 作者 becomes")).toHaveValue("core:maker");

  // Nothing is written yet, and the screen says exactly what would be.
  await expect(page.getByRole("heading", { name: "10 lots will be created" })).toBeVisible();
  await page.screenshot({ path: shot("04-matching"), fullPage: true });

  // ── 5. Manual clearance ─────────────────────────────────────────────────
  // Overriding a suggestion is one interaction, and the preview follows it.
  await page.getByLabel("What 說明 becomes").selectOption("core:description");
  await expect(page.getByLabel("What 說明 becomes")).toHaveValue("core:description");

  await page.getByRole("button", { name: /Import 10 lots/ }).click();

  await page.waitForURL(eventUrl);
  await expect(page.getByText(/10 lots · 0 photographed/)).toBeVisible();
  // The values arrived verbatim. "P01" is a string and must not have become 1,
  // and an estimate is a RANGE — both are failures the predecessor's corpus
  // documented and both are invisible until someone looks at a row.
  await expect(page.getByRole("cell", { name: "P01", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: /800,000 – 1,200,000 HKD/ })).toBeVisible();
  await page.screenshot({ path: shot("05-lots"), fullPage: true });

  // ── 6. The template generates a layout ──────────────────────────────────
  // SCOPED TO THE CONTENT COLUMN. The rail holds a place called Catalogue as
  // well — Compose, in the function-first navigation — and this step is about
  // the action on THIS event's header, not about the global list. Saying which
  // one it means is the fix; `.first()` would have depended on document order.
  await page.locator("main").getByRole("link", { name: "Catalogue" }).click();
  await expect(page.getByRole("heading", { name: "Catalogue" })).toBeVisible();

  const frame = page.frameLocator('iframe[title="Catalogue preview"]');
  await expect(frame.locator(".page")).toHaveCount(3); // 10 lots at 4-up
  await expect(frame.locator(".slot")).toHaveCount(10);
  await expect(frame.locator(".line--title").first()).toContainText("青花纏枝蓮紋梅瓶");
  await page.screenshot({ path: shot("06-catalogue"), fullPage: true });

  // Density re-derives rather than re-flows a frozen document.
  await page.getByLabel("Per page").selectOption("9");
  await expect(frame.locator(".page")).toHaveCount(2);
  await expect(frame.locator(".slot")).toHaveCount(10);
  await page.screenshot({ path: shot("07-catalogue-9up"), fullPage: true });

  // THE CONTROL MUST AGREE WITH THE DOCUMENT. It did not: the select kept a
  // stale value after the round trip, so the next change to any other control
  // posted the old density back and silently reverted the layout.
  await expect(page.getByLabel("Per page")).toHaveValue("9");

  // 符合頁面 and 符合寬度 must not behave identically — they did in the
  // predecessor at two-up, and it is on the carried-defects list in ROADMAP M1.
  const wholePageWidth = await frame.locator(".page").first().evaluate(
    (el) => el.getBoundingClientRect().width,
  );
  await page.getByLabel("Fit").selectOption("width");
  await expect
    .poll(async () =>
      frame.locator(".page").first().evaluate((el) => el.getBoundingClientRect().width),
    )
    .toBeGreaterThan(wholePageWidth);
  // Changing the fit must not have carried the density away with it.
  await expect(page.getByLabel("Per page")).toHaveValue("9");
  await expect(page.getByText(/2 pages · 10 lots/)).toBeVisible();
  await page.screenshot({ path: shot("08-catalogue-fit-width"), fullPage: true });
});

// ── The control ───────────────────────────────────────────────────────────
//
// ARCHITECTURE.md principle 8. The preview is inert because of its
// Content-Security-Policy and NOT because of a sandbox attribute — a sandbox
// without allow-scripts stops WebKit dispatching DOM events into the frame at
// all, which killed the predecessor's editing layer in Safari for a year while
// Chromium-only testing reported everything green.
//
// So two things are checked, and both matter: a script injected into the frame
// does NOT run, and the frame carries NO sandbox attribute. Asserting only the
// first would pass on a sandboxed frame, which is the configuration this exists
// to prevent.
test("the preview frame is inert by policy, not by sandbox", async ({ page }) => {
  await page.goto("/");
  const firstEvent = page.locator("tbody tr a").first();
  await expect(firstEvent).toBeVisible();
  await firstEvent.click();
  // The event's own header, not the rail's place of the same name.
  await page.locator("main").getByRole("link", { name: "Catalogue" }).click();

  const iframe = page.locator('iframe[title="Catalogue preview"]');
  await expect(iframe).toBeVisible();
  expect(await iframe.getAttribute("sandbox")).toBeNull();

  // Not anchored: the src carries a version key so that changing the density
  // actually reloads the frame.
  const frame = page.frame({ url: /\/catalogue\/preview/ });
  expect(frame).not.toBeNull();

  const ran = await frame!.evaluate(() => {
    const script = document.createElement("script");
    script.textContent = "window.__cspControlRan = true;";
    document.body.appendChild(script);
    return (window as unknown as { __cspControlRan?: boolean }).__cspControlRan === true;
  });
  expect(ran, "a script injected into the preview must not execute").toBe(false);
});
