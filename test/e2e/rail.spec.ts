// The rail, driven.
//
// The navigation is the first thing a customer reads and the last thing anyone
// tests, which is how a product ends up with a menu item that 404s. So this
// asserts the three things the reorganisation can get wrong and a unit test
// cannot see: that every category is on screen, that a category with nothing
// behind it cannot be clicked into a hole, and that collapsing one is remembered
// without ever hiding the page the viewer is actually on.
//
// The screenshots are the point. ARCHITECTURE.md principle 10: "the tests pass"
// is not evidence that an interface exists.

import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { expect, test, type Locator, type Page } from "@playwright/test";

const SHOTS = join("test", "e2e", "screens");
mkdirSync(SHOTS, { recursive: true });
const shot = (name: string): string => join(SHOTS, `${name}.png`);

const rail = (page: Page): Locator =>
  page.getByRole("navigation", { name: "Sections" });

// The operator's own cycle, in the order DFD.md §1 draws it.
const CATEGORIES = [
  "Record",
  "Capture",
  "Compose",
  "Publish",
  "Move",
  "Connect",
  "Admin",
];

// Named only — DFD.md §2. These must render (a gallery or a museum reading the
// rail has to see where their own work would go) and must not be reachable
// (there is nothing there, and a dead link is worse than an absence).
const NOT_BUILT = ["Move", "Connect", "Admin"];

test("the rail names the whole cycle, and names what is not built yet", async ({
  page,
}) => {
  await page.goto("/photographs");
  const nav = rail(page);

  for (const label of CATEGORIES) {
    await expect(nav.getByText(label, { exact: true })).toBeVisible();
  }

  // NOTHING TO CLICK, so nothing to 404. Asserted as the absence of a role
  // rather than as the presence of a style, because a disabled-looking link is
  // still a link and a customer will find it.
  for (const label of NOT_BUILT) {
    await expect(nav.getByRole("link", { name: label })).toHaveCount(0);
    await expect(nav.getByRole("button", { name: label })).toHaveCount(0);
  }
  // And they say so in words, so "not yet" cannot be mistaken for "broken".
  await expect(nav.getByText("not yet")).toHaveCount(NOT_BUILT.length);

  // The category holding the current page is open on arrival.
  await expect(nav.getByRole("button", { name: "Capture" })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await expect(nav.getByRole("link", { name: /^Photographs/ })).toBeVisible();
  await page.screenshot({ path: shot("30-rail-categories"), fullPage: true });
  // And the rail on its own, because a 220px column inside a 1440px page is not
  // something anyone can actually read in a full-page capture.
  await page.locator("aside").screenshot({ path: shot("30-rail-detail") });
});

test("a collapsed category stays collapsed — unless you are standing in it", async ({
  page,
}) => {
  await page.goto("/photographs");
  const nav = rail(page);

  // Collapse one the viewer is NOT in. Record holds two places, so its rows
  // disappearing is visible in the screenshot rather than only in an attribute.
  await nav.getByRole("button", { name: "Record" }).click();
  await expect(nav.getByRole("link", { name: "Events" })).toBeHidden();
  await page.screenshot({ path: shot("31-rail-collapsed"), fullPage: true });
  await page.locator("aside").screenshot({ path: shot("31-rail-collapsed-detail") });

  // It survives a full reload: the preference is the viewer's, not the page's.
  await page.reload();
  await expect(nav.getByRole("button", { name: "Record" })).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await expect(nav.getByRole("link", { name: "Events" })).toBeHidden();

  // ── AND THE RULE THAT OVERRIDES IT ──────────────────────────────────────
  // Arriving inside a collapsed category opens it. A rail that hides where the
  // viewer currently is has stopped being a map — so the stored answer loses to
  // the present tense, every time.
  await page.goto("/");
  await expect(nav.getByRole("button", { name: "Record" })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await expect(nav.getByRole("link", { name: "Events" })).toBeVisible();
});

test("every place in the rail is a place, not a dead link", async ({ page }) => {
  await page.goto("/");
  const nav = rail(page);

  // Each item, clicked the way a person clicks it, landing on a page that says
  // what it is. A 404 would fail on the heading.
  const places: [string, string][] = [
    ["Events", "Events"],
    ["Import", "Import"],
    ["Photographs", "Photographs"],
    ["Catalogue", "Catalogues"],
    ["PDF export", "PDF export"],
  ];

  for (const [item, heading] of places) {
    await nav.getByRole("link", { name: item }).click();
    await expect(
      page.getByRole("heading", { name: heading, exact: true }),
    ).toBeVisible();
  }

  // The three that carry a function the rail did not have before, captured
  // because a new screen nobody has looked at is a screen nobody has shipped.
  await page.goto("/import");
  await page.screenshot({ path: shot("32-import"), fullPage: true });
  await page.goto("/catalogues");
  await page.screenshot({ path: shot("33-catalogues"), fullPage: true });
  await page.goto("/exports");
  await page.screenshot({ path: shot("34-exports"), fullPage: true });
});
