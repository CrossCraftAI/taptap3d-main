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
// lands on. The same two are held in test/nav.test.ts; change both on purpose.
//
// TWO, not four. `/catalogues` and `/exports` were one component over the same
// rows as this ledger with a different verb, and the verb is now the row's own
// next action — so the rail listed two extra doors into a table it already had
// a door to. Both screens are gone; neither capability is.
const HOUSE: [string, string][] = [
  ["Events", "Events"],
  ["Photographs", "Photographs"],
];

// What the rail must NOT say any more. "Import" is here because importing is an
// action and lives in the palette; the rail holds places.
const GONE = ["Record", "Capture", "Compose", "Publish", "Move", "Connect", "Admin", "Import"];

// How many sales the switcher's panel draws. Written out rather than imported,
// the way HOUSE above is: nothing else in this directory reaches into `src`,
// and the number is a product decision held in two places on purpose.
// src/lib/nav.ts SWITCHER_ROWS is the other one and it carries the arithmetic.
const SWITCHER_ROWS = 10;

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
  await expect(nav.getByRole("link", { name: /^Photographs/ })).toBeVisible();

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

  // The two screens the rail used to hold, as one ledger: the default view,
  // and the whole archive behind the All tab.
  await page.goto("/");
  await page.screenshot({ path: shot("33-ledger-open"), fullPage: true });
  await page.goto("/?stage=all");
  await page.screenshot({ path: shot("34-ledger-all"), fullPage: true });
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
  // Six places now: the event's four and the house's two.
  await expect(nav.getByRole("link")).toHaveCount(HOUSE.length + 4);

  // THE INNERMOST CLAIM WINS. An editor path is honestly both this event's
  // Editor and the house's Events; marking both would leave a person unable to
  // read their position off the rail, which is its only job.
  await expect(nav.getByRole("link", { name: "Editor" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(nav.locator("[aria-current]")).toHaveCount(1);
  await page.screenshot({ path: shot("32-rail-event-group"), fullPage: true });

  // THE SALE'S OWN SIZE, beside the row that leads to it. `^Lots` rather than
  // `Lots`: the count is part of the link's accessible name, the same way it
  // already is for Events and Photographs. A sale quick-added and not yet
  // imported has none, and NOUGHT is the honest answer to "how big is it" —
  // the thing that must never appear is a nought standing in for "the shell
  // could not find that sale".
  await expect(nav.getByRole("link", { name: /^Lots/ })).toContainText("0");

  // Both of the event's places are real pages.
  await nav.getByRole("link", { name: /^Lots/ }).click();
  await page.waitForURL(eventUrl);
  await expect(nav.getByRole("link", { name: /^Lots/ })).toHaveAttribute(
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

  // The menu names the most recently touched sales — these two are the two
  // most recent, because this test just made them — ticks the open one, and
  // carries the way out at its head.
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
  // WAIT FOR A DIFFERENT EDITOR, not for an editor. The pattern on its own is
  // satisfied by the page this test is already standing on, so `waitForURL`
  // returned before the click had navigated anywhere and the assertion below
  // compared the starting URL with itself. It failed on both engines, which
  // is what a race in the test rather than in the product looks like.
  await page.waitForURL((url) => /\/catalogue$/.test(url.pathname) && url.href !== editorUrl);
  expect(page.url()).not.toBe(editorUrl);
  await expect(page.locator("main").getByRole("link", { name: first })).toBeVisible();
  await expect(page.locator("#topbar").getByRole("button")).toContainText(first);

  // And the way out goes to the ledger.
  await page.locator("#topbar").getByRole("button").click();
  await page.locator("#topbar").getByRole("link", { name: /All events/ }).click();
  await expect(page.getByRole("heading", { name: "Events" })).toBeVisible();
});

test("the switcher is ten rows and a search, not every sale there is", async ({
  page,
}) => {
  // WHAT THIS IS FOR, in one number: with 484 sales in the org, the shell
  // painted 485 anchors into every document and the ledger was 367,281 bytes
  // — measured on a production build against `next start`, by counting the
  // rows in the served HTML. A menu nobody had opened was most of the page.
  //
  // A driven test cannot assert a byte count that moves with the data, so it
  // asserts the thing that produced it: the panel draws a bounded number of
  // rows however many sales exist, and what it does not draw is findable.
  //
  // A CAP'S WORTH IS MADE HERE rather than assumed of the database. The
  // machine this was written on had 484 sales in the org and a fresh CI
  // database has none, and a test that only proves a cap when somebody else's
  // spec happened to run first proves nothing. Eleven creations is the price
  // of a deterministic one.
  test.slow();
  const oldest = `Cap first ${RUN}`;
  await createEvent(page, oldest);
  for (let i = 1; i <= SWITCHER_ROWS; i++) {
    await createEvent(page, `Cap ${i} ${RUN}`);
  }

  await page.goto("/");
  const bar = page.locator("#topbar");
  const switcher = bar.getByRole("button");
  await switcher.click();

  // TEN, plus the way out at the head and the way in at the foot — both of
  // those point at the ledger, so the event rows are the ones whose href is
  // an event. src/lib/nav.ts SWITCHER_ROWS carries the arithmetic behind the
  // number; this holds that the number is obeyed.
  const rows = bar.locator("a[href^='/events/']");
  await expect(rows).toHaveCount(SWITCHER_ROWS);
  await page.screenshot({ path: shot("36-switcher-capped") });

  // AND THE SEARCH READS ALL OF THEM, not the ten. `oldest` is the first sale
  // this test made and at least ten were made after it, so it is off the end
  // of the drawn list by construction — which is exactly the sale a filter
  // over a truncated list could not find.
  const search = bar.getByRole("searchbox", { name: "Search events" });
  await expect(search).toBeFocused();
  await expect(bar.getByRole("link", { name: new RegExp(oldest) })).toHaveCount(0);
  await search.fill(oldest);
  await expect(bar.getByRole("link", { name: new RegExp(oldest) })).toBeVisible();
  await expect(rows).toHaveCount(1);
  await page.screenshot({ path: shot("37-switcher-search") });

  // A word that is in no sale says so, and says how much there was to look
  // through — the palette's own empty state, for the same reason.
  await search.fill("nothing is called this");
  await expect(rows).toHaveCount(0);
  await expect(bar.getByText(/Nothing here matches/)).toBeVisible();

  // Shutting it forgets what was typed: a panel that reopens already filtered
  // looks like a panel that has lost its rows.
  await page.keyboard.press("Escape");
  await switcher.click();
  await expect(search).toHaveValue("");
  await expect(rows).toHaveCount(SWITCHER_ROWS);
});

test("a sale can be started from the strip that is on every screen", async ({
  page,
}) => {
  // THE PROMISE THE DRAWING MADE AND THREE TRANCHES DROPPED. From the editor
  // there was no way to start a sale without going to the ledger and hunting
  // for the quick-add line. There is no second creation path here — the row
  // lands on that line, and `createEventAction` stays the only way a sale is
  // made.
  const { editorUrl } = await createEvent(page, `New From Bar ${RUN}`);
  await page.goto(editorUrl);
  await page.getByRole("button", { name: "Navigation" }).click();

  const bar = page.locator("#topbar");
  await bar.getByRole("button").click();
  const create = bar.getByRole("link", { name: /New event/ });
  await expect(create).toBeVisible();
  await create.click();

  // On the ledger, with the blank line it named waiting to be filled — and
  // filling it makes a sale, which is the whole claim.
  await expect(page.getByRole("heading", { name: "Events" })).toBeVisible();
  const made = `Bar Made ${RUN}`;
  await page.getByLabel("Event name").fill(made);
  await page.getByRole("button", { name: "Create event" }).click();
  await page.waitForURL(/\/events\/[0-9a-f-]+\/catalogue$/);
  await expect(page.getByRole("link", { name: made })).toBeVisible();
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
