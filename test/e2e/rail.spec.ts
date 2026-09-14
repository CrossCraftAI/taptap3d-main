// The rail, driven.
//
// The navigation is the first thing a customer reads and the last thing anyone
// tests, which is how a product ends up with a menu item that 404s. The rail was
// seven categories filed as a menu — a sequence of four and three "not yet"
// labels — and the owner rejected it. So this asserts what the flattening can
// get wrong and a unit test cannot see: that the rail is exactly the four places
// and nothing else, that none of them is a dead link, that nothing in it is a
// control (there is nothing to collapse any more), and that an event's own
// screens light the place that owns them.
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

// A feature list, in the order it is drawn. The same four are held in
// test/nav.test.ts; change both on purpose.
const PLACES: [string, string][] = [
  ["Events", "Events"],
  ["Photographs", "Photographs"],
  ["Catalogues", "Catalogues"],
  ["Exports", "Exports"],
];

// What the rail must NOT say any more.
const GONE = ["Record", "Capture", "Compose", "Publish", "Move", "Connect", "Admin", "Import"];

test("the rail is a flat list of what is built, and nothing else", async ({
  page,
}) => {
  await page.goto("/photographs");
  const nav = rail(page);

  // Exactly four links, in order. The count beside a name is part of the
  // link's text, so it is stripped before comparing.
  const links = nav.getByRole("link");
  await expect(links).toHaveCount(PLACES.length);
  // EVERY trailing number, not the last one: Photographs carries two — the
  // unassigned badge and the total — so stripping one left "Photographs\n27"
  // and compared it against "Photographs".
  const names = (await links.allInnerTexts()).map((t) =>
    t.replace(/[\s\d]+$/, "").trim(),
  );
  expect(names).toEqual(PLACES.map(([label]) => label));

  // NOTHING TO COLLAPSE, nothing pretending to be here. Asserted as the
  // absence of a role and of the words, because a disabled-looking control is
  // still a control and a customer will find it.
  await expect(nav.getByRole("button")).toHaveCount(0);
  await expect(nav.getByText("not yet")).toHaveCount(0);
  for (const word of GONE) {
    await expect(nav.getByText(word, { exact: true })).toHaveCount(0);
  }

  // Where the viewer is standing is marked, and nothing else is.
  await expect(nav.getByRole("link", { name: /^Photographs/ })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(nav.locator("[aria-current]")).toHaveCount(1);

  await page.screenshot({ path: shot("30-rail"), fullPage: true });
  // And the rail on its own, because a 220px column inside a 1440px page is not
  // something anyone can actually read in a full-page capture.
  await page.locator("aside").screenshot({ path: shot("30-rail-detail") });
});

test("every place in the rail is a place, not a dead link", async ({ page }) => {
  await page.goto("/");
  const nav = rail(page);

  // Each item, clicked the way a person clicks it, landing on a page that says
  // what it is. A 404 would fail on the heading.
  for (const [item, heading] of PLACES) {
    await nav.getByRole("link", { name: new RegExp(`^${item}`) }).click();
    await expect(
      page.getByRole("heading", { name: heading, exact: true }),
    ).toBeVisible();
  }

  await page.goto("/catalogues");
  await page.screenshot({ path: shot("33-catalogues"), fullPage: true });
  await page.goto("/exports");
  await page.screenshot({ path: shot("34-exports"), fullPage: true });
});

test("an event's own screens light the place that owns them", async ({ page }) => {
  await page.goto("/");
  const nav = rail(page);

  // An event is an event, wherever you are inside it …
  await page.locator("tbody tr a").first().click();
  await page.waitForURL(/\/events\//);
  await expect(nav.getByRole("link", { name: /^Events/ })).toHaveAttribute(
    "aria-current",
    "page",
  );

  // … except its catalogue, which is the catalogues. The header's own link,
  // whichever the stage has made it — "Catalogue" standing, or "Open catalogue"
  // as the next action.
  await page.locator("main").getByRole("link", { name: /^(Open c|C)atalogue$/ }).click();
  await expect(page.getByRole("heading", { name: "Catalogue" })).toBeVisible();
  await expect(nav.getByRole("link", { name: /^Catalogues/ })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(nav.locator("[aria-current]")).toHaveCount(1);
});
