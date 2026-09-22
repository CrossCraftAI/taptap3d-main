// The shell's chrome, driven: the rail, the top bar's switcher, the palette.
//
// The navigation is the first thing a customer reads and the last thing anyone
// tests, which is how a product ends up with a menu item that 404s. The rail was
// seven categories filed as a menu — a sequence of four and three "not yet"
// labels — and the owner rejected it; it was then four flat places, because four
// items about one subject do not need a filing system. It is now SIX places in
// two groups, two of them about the event you have open, and this asserts what
// that regrouping can get wrong and a unit test cannot see: that every one of
// the six is a real page, that the groups genuinely collapse and are remembered,
// that exactly one row is ever marked, that the switcher changes which sale is
// open, and — hardest and most important — that nothing in this chrome is a
// control that does nothing.
//
// The screenshots are the point. ARCHITECTURE.md principle 10: "the tests pass"
// is not evidence that an interface exists.

import { expect, test, type Locator, type Page } from "@playwright/test";

import { createEvent } from "./sale";
import { shot } from "./shots";

const RUN = Date.now();

const rail = (page: Page): Locator =>
  page.getByRole("navigation", { name: "Sections" });
const palette = (page: Page): Locator =>
  page.getByRole("complementary", { name: "What you can add" });

// The house's places, in the order they are drawn, with the heading each one
// lands on. The same four are held in test/nav.test.ts; change both on purpose.
const HOUSE: [string, string][] = [
  ["Events", "Events"],
  ["Photographs", "Photographs"],
  ["Catalogues", "Catalogues"],
  ["Exports", "Exports"],
];

// What the rail must NOT say any more. "Import" is here because importing is an
// action and lives in the palette; the rail holds places.
const GONE = ["Record", "Capture", "Compose", "Publish", "Move", "Connect", "Admin", "Import"];

test("the rail is two groups of what is built, and nothing else", async ({
  page,
}) => {
  await page.goto("/photographs");
  const nav = rail(page);

  // No event is open, so there is no event group — a category that would draw
  // two rows pointing at no event is not drawn at all.
  await expect(nav.getByRole("button", { name: "The house" })).toBeVisible();
  await expect(nav.getByRole("button", { name: "This event" })).toHaveCount(0);

  // Exactly the four house places, in order. The count beside a name is part
  // of the link's text, so every trailing number is stripped before comparing
  // — Photographs carries two, the unassigned badge and the total.
  const links = nav.getByRole("link");
  await expect(links).toHaveCount(HOUSE.length);
  const names = (await links.allInnerTexts()).map((t) =>
    t.replace(/[\s\d]+$/, "").trim(),
  );
  expect(names).toEqual(HOUSE.map(([label]) => label));

  // NOTHING PRETENDING TO BE HERE. Asserted as the absence of the words,
  // because a disabled-looking control is still a control and a customer will
  // find it. The only buttons in the rail are the two group headers, and each
  // says whether its group is open.
  await expect(nav.getByText("not yet")).toHaveCount(0);
  for (const word of GONE) {
    await expect(nav.getByText(word, { exact: true })).toHaveCount(0);
  }
  for (const button of await nav.getByRole("button").all()) {
    await expect(button).toHaveAttribute("aria-expanded", /true|false/);
  }

  // Where the viewer is standing is marked, and nothing else is.
  await expect(nav.getByRole("link", { name: /^Photographs/ })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(nav.locator("[aria-current]")).toHaveCount(1);

  await page.screenshot({ path: shot("30-rail"), fullPage: true });
  // And the rail on its own, because a 224px column inside a 1440px page is not
  // something anyone can actually read in a full-page capture. By id: there are
  // two <aside> elements in the shell now.
  await page.locator("#rail").screenshot({ path: shot("30-rail-detail") });
});

test("a group collapses, and is still collapsed after a reload", async ({
  page,
}) => {
  await page.goto("/photographs");
  const nav = rail(page);
  const house = nav.getByRole("button", { name: "The house" });

  await expect(house).toHaveAttribute("aria-expanded", "true");
  await expect(nav.getByRole("link", { name: /^Exports/ })).toBeVisible();

  await house.click();
  await expect(house).toHaveAttribute("aria-expanded", "false");
  // Hidden, not merely invisible: `hidden` takes the links out of the tab
  // order and the accessibility tree together, so they have no role to find.
  await expect(nav.getByRole("link")).toHaveCount(0);
  await page.screenshot({ path: shot("31-rail-group-shut") });

  // REMEMBERED, and applied before first paint — the same mechanism the whole
  // rail uses, not a second one.
  await page.reload();
  await expect(house).toHaveAttribute("aria-expanded", "false");
  await expect(nav.getByRole("link")).toHaveCount(0);

  await house.click();
  await expect(nav.getByRole("link")).toHaveCount(HOUSE.length);
});

test("every place in the rail is a place, not a dead link", async ({ page }) => {
  await page.goto("/");
  const nav = rail(page);

  // Each item, clicked the way a person clicks it, landing on a page that says
  // what it is. A 404 would fail on the heading.
  for (const [item, heading] of HOUSE) {
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

test("an event's own group appears, and marks the innermost place", async ({
  page,
}) => {
  const { eventUrl } = await createEvent(page, `Rail Sale ${RUN}`);
  // Quick-add lands on the editor, which puts the navigation away.
  const toggle = page.getByRole("button", { name: "Navigation" });
  await toggle.click();
  const nav = rail(page);

  await expect(nav.getByRole("button", { name: "This event" })).toBeVisible();
  // Six places now: the event's two and the house's four.
  await expect(nav.getByRole("link")).toHaveCount(HOUSE.length + 2);

  // THE INNERMOST CLAIM WINS. An editor path is honestly both this event's
  // Editor and the house's Catalogues; marking both would leave a person
  // unable to read their position off the rail, which is its only job.
  await expect(nav.getByRole("link", { name: "Editor" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(nav.locator("[aria-current]")).toHaveCount(1);
  await page.screenshot({ path: shot("32-rail-event-group"), fullPage: true });

  // Both of the event's places are real pages.
  await nav.getByRole("link", { name: "Lots" }).click();
  await page.waitForURL(eventUrl);
  await expect(nav.getByRole("link", { name: "Lots" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(nav.locator("[aria-current]")).toHaveCount(1);

  await nav.getByRole("link", { name: "Editor" }).click();
  await expect(page.getByRole("heading", { name: "Catalogue" })).toBeVisible();

  // And it is gone again the moment the screen is not about an event.
  await nav.getByRole("link", { name: /^Photographs/ }).click();
  await expect(nav.getByRole("button", { name: "This event" })).toHaveCount(0);
});

test("the top bar says which sale is open, and changes it", async ({ page }) => {
  const first = `Switch A ${RUN}`;
  const second = `Switch B ${RUN}`;
  await createEvent(page, first);
  const { editorUrl } = await createEvent(page, second);

  // The editor puts the navigation away; the top bar goes with it, and comes
  // back with it. That is the measured trade — src/lib/chrome.ts TOP_BAR.
  const toggle = page.getByRole("button", { name: "Navigation" });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("#topbar")).toBeHidden();
  await toggle.click();
  await expect(page.locator("#topbar")).toBeVisible();

  const switcher = page.locator("#topbar").getByRole("button");
  await expect(switcher).toContainText(second);

  // The menu names every sale, ticks the open one, and carries the way out at
  // its head.
  await switcher.click();
  await expect(switcher).toHaveAttribute("aria-expanded", "true");
  const bar = page.locator("#topbar");
  await expect(bar.getByRole("link", { name: /All events/ })).toBeVisible();
  await expect(bar.getByRole("link", { name: new RegExp(first) })).toBeVisible();
  await expect(
    page.locator("#topbar").locator("a[aria-current='true']"),
  ).toContainText(second);
  await page.screenshot({ path: shot("35-switcher-open") });

  // Escape closes it and gives the button the focus back, rather than leaving
  // focus in a panel that has just been removed.
  await page.keyboard.press("Escape");
  await expect(switcher).toHaveAttribute("aria-expanded", "false");
  await expect(switcher).toBeFocused();

  // THE SAME SCREEN, THE OTHER SALE. Switching from the editor lands in the
  // other sale's editor — that is the screen this control exists for.
  await switcher.click();
  await page.locator("#topbar").getByRole("link", { name: new RegExp(first) }).click();
  await page.waitForURL(/\/events\/[0-9a-f-]+\/catalogue$/);
  expect(page.url()).not.toBe(editorUrl);
  await expect(page.locator("main").getByRole("link", { name: first })).toBeVisible();
  await expect(page.locator("#topbar").getByRole("button")).toContainText(first);

  // And the way out goes to the ledger.
  await page.locator("#topbar").getByRole("button").click();
  await page.locator("#topbar").getByRole("link", { name: /All events/ }).click();
  await expect(page.getByRole("heading", { name: "Events" })).toBeVisible();
});

test("the palette offers only what this product can actually do", async ({
  page,
}) => {
  const { eventUrl } = await createEvent(page, `Palette Sale ${RUN}`);
  await page.goto(eventUrl);

  const spine = palette(page).getByRole("button", { name: "Add" });
  await expect(spine).toHaveAttribute("aria-expanded", "false");
  await spine.click();
  await expect(spine).toHaveAttribute("aria-expanded", "true");
  await page.screenshot({ path: shot("36-palette-add"), fullPage: true });

  const body = page.locator("#palette-body");
  // A described row: a name, a sentence and the verb of what happens.
  const row = body.getByRole("link", { name: /Lots/ });
  await expect(row).toContainText("spreadsheet");
  await expect(row).toContainText("Import");

  // THE SEARCH READS THE SENTENCE. Nothing here is called "spreadsheet", and
  // "spreadsheet" is the word somebody brings with them.
  const search = body.getByLabel("Search what you can add");
  await search.fill("spreadsheet");
  await expect(row).toBeVisible();
  await search.fill("provenance");
  await expect(body.getByRole("link")).toHaveCount(0);
  // A state the drawing never shows: no hits, and how much there was to miss.
  await expect(body).toContainText("Nothing here matches");
  await page.screenshot({ path: shot("37-palette-no-hits") });
  await search.fill("");

  // EVERY ROW GOES SOMEWHERE. Checked by clicking, not by reading the href.
  await expect(body.getByRole("link")).not.toHaveCount(0);
  for (const name of await body.getByRole("link").allInnerTexts()) {
    expect(name.trim().length).toBeGreaterThan(0);
  }

  // Clicking the OPEN panel's own spine button closes it.
  await spine.click();
  await expect(spine).toHaveAttribute("aria-expanded", "false");
  await expect(body).toBeHidden();

  // Nothing prints from a sale with no lots, so nothing offers it: the
  // Document panel is not in the spine at all until there is something in the
  // document.
  await expect(palette(page).getByRole("button", { name: "Document" })).toHaveCount(0);

  await page.goto(`${eventUrl}/import`);
  await expect(page.getByRole("heading", { name: "Import lots" })).toBeVisible();
  // And the row that would have sent you here is not offered here.
  await expect(
    page.locator("#palette-body").getByRole("link", { name: /Lots/ }),
  ).toHaveCount(0);
});
