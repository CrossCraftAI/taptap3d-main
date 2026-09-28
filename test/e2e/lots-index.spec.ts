// The sale's index: search it, narrow it, page it.
//
// ── WHAT ONLY A BROWSER CAN ANSWER HERE ─────────────────────────────────────
//
// test/lots-view.test.ts is a table of cases over the arithmetic — the counts,
// the clamp, the window, the URLs — and it would pass with this screen wired to
// nothing. Three things it cannot see:
//
//   THE FORM IS A GET FORM. The search is a `<form method="get">` with the
//   filter riding as a hidden field, which means the browser builds the URL,
//   not us. Whether that URL is the one `readQuery` reads back is a round trip
//   through an actual browser or it is an assumption.
//
//   THE PAGE NUMBER IS THE ENGINE'S. The column comes from a real `derive()`
//   over the real document, so it is only right if the same lots land on the
//   same sheets here as in the editor beside it.
//
//   A LONG SALE IS THE POINT. Every number in the view model is uninteresting
//   at eight lots; this seeds sixty so the paging is real.
//
// Runs against the BUILT application and a real database, one worker.

import { expect, test, type Page } from "@playwright/test";

import { createEvent, pasteAndRead } from "./sale";
import { shot } from "./shots";

const RUN = Date.now();
const TAG = `IX${RUN % 100000}`;

const WINDOW = { width: 1440, height: 900 };
test.use({ viewport: WINDOW });

test.describe.configure({ timeout: 180_000 });

/** Sixty lots: more than one page, and the titles differ in a searchable way. */
async function saleOfSixty(page: Page): Promise<string> {
  const { eventUrl } = await createEvent(page, `Index ${RUN}`);
  const rows = ["ref,title,price"];
  for (let n = 1; n <= 60; n++) {
    // Two title families, so a search has something to cut by that is not the
    // reference — 20 scrolls and 40 vases.
    const kind = n % 3 === 0 ? "手卷" : "梅瓶";
    rows.push(`${TAG}${String(n).padStart(3, "0")},青花${kind}${n},"HK$${n}0,000–${n}0,000"`);
  }
  await page.goto(`${eventUrl}/import`);
  await pasteAndRead(page, `${rows.join("\n")}\n`);
  await page.getByRole("button", { name: /Import|Commit/ }).first().click();
  await page.waitForURL(new RegExp(`${eventUrl.split("/").pop()}$`));
  return eventUrl;
}

const rowsOf = (page: Page) => page.locator("tbody tr[data-lot]");

test("the sale's index searches, narrows and pages, and every view is an address", async ({
  page,
}) => {
  const eventUrl = await saleOfSixty(page);

  // ── ONE PAGE OF FIFTY, AND IT SAYS SO ────────────────────────────────────
  await expect(rowsOf(page)).toHaveCount(50);
  await expect(page.getByRole("status")).toContainText("Showing 1–50 of 60");
  await expect(page.getByRole("link", { name: /^All/ })).toContainText("60");
  await page.screenshot({ path: shot("96-index-page-one") });

  // ── PAGE TWO IS A LINK, AND IT IS THE REST ───────────────────────────────
  await page.getByRole("link", { name: "Next ›" }).click();
  await expect(page).toHaveURL(/page=2/);
  await expect(rowsOf(page)).toHaveCount(10);
  await expect(page.getByRole("status")).toContainText("Showing 51–60 of 60");

  // ── THE SEARCH IS A GET FORM, SO THE BROWSER BUILDS THE URL ──────────────
  // Twenty of the sixty are 手卷. The assertion is on the URL as well as the
  // rows, because an address somebody can send is half of what this is for.
  await page.goto(eventUrl);
  await page.getByPlaceholder("Find a lot by reference or title").fill("手卷");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page).toHaveURL(/q=/);
  await expect(rowsOf(page)).toHaveCount(20);
  await expect(page.getByRole("status")).toContainText("of 20");

  // A NEW SEARCH STARTS AT THE BEGINNING: the page does not ride along, so
  // this cannot land past the end of a shorter result.
  await expect(page).not.toHaveURL(/page=/);

  // ── THE TABS COUNT WHAT THE SEARCH LEFT, NOT THE SALE ────────────────────
  // This is the rule the view model states and the one a person would never
  // check: "No photograph 132" over four visible rows is a number about a set
  // nobody is looking at. None of these sixty has a photograph, so the
  // unphotographed tab must read 20 here and 60 with the search cleared.
  await expect(page.getByRole("link", { name: /^No photograph/ })).toContainText("20");
  await page.getByRole("link", { name: "Clear" }).click();
  await expect(page.getByRole("link", { name: /^No photograph/ })).toContainText("60");
  await page.screenshot({ path: shot("97-index-searched") });

  // ── A STALE LINK IS CLAMPED, NOT SHOWN EMPTY ─────────────────────────────
  await page.goto(`${eventUrl}?page=99`);
  await expect(rowsOf(page)).toHaveCount(10);
  await expect(page.getByRole("status")).toContainText("Showing 51–60 of 60");
});

test("the page column is the engine's own answer, not the screen's arithmetic", async ({
  page,
}) => {
  const eventUrl = await saleOfSixty(page);

  // The built-in catalogue is four to a sheet, so lot 1 is on page 1 and lot 5
  // is on page 2. The number has to come from a real derivation of the real
  // document — the editor's lots panel prints the same one — because two ways
  // of working it out is how two screens come to disagree about one sale.
  // BY NAME, NOT BY COLUMN NUMBER. The first draft counted to the fifth `td`
  // and broke the day a checkbox column arrived in front of it — a spec that
  // counts columns is a spec that fails on a layout decision.
  const pageCell = (n: number) =>
    page.locator(`tbody tr[data-lot] >> nth=${n - 1}`).locator("[data-page]");
  await expect(pageCell(1)).toHaveText("1");
  await expect(pageCell(5)).toHaveText("2");
  await expect(pageCell(9)).toHaveText("3");

  // AND IT FOLLOWS THE DENSITY. Nine to a sheet moves lot 5 onto page 1 — if
  // this column were computed here rather than derived, it would not move.
  await page.goto(`${eventUrl}/catalogue`);
  await page.selectOption('select[name="perPage"]', "9");
  // RETRIED OVER THE WHOLE READ, because the density is a server action and
  // not a navigation: there is no URL to wait on, and coming back to the index
  // too early reads the document as it was. The claim being made is exactly
  // the assertion inside the retry — nine to a sheet puts lot 5 on page 1 —
  // so waiting for a proxy for it would be waiting for the wrong thing.
  await expect(async () => {
    await page.goto(eventUrl);
    await expect(pageCell(5)).toHaveText("1", { timeout: 5_000 });
    await expect(pageCell(10)).toHaveText("2", { timeout: 5_000 });
  }).toPass({ timeout: 90_000 });
});

test("a run of lots is picked with the pointer and moved as one gesture", async ({ page }) => {
  const eventUrl = await saleOfSixty(page);
  const boxes = page.locator('tbody tr[data-lot] input[type="checkbox"]');

  // ── SHIFT EXTENDS THE RUN ────────────────────────────────────────────────
  // Two clicks pick five lots. test/selection.test.ts is the table of cases
  // over the gesture; what this adds is that the gesture is WIRED — a pure
  // function with no pointer on it would pass either way.
  await boxes.nth(1).click();
  await boxes.nth(5).click({ modifiers: ["Shift"] });
  await expect(page.getByText("5 selected")).toBeVisible();
  await expect(page.getByRole("button", { name: "Move 5" })).toBeVisible();

  // ── ONE DESTINATION, AND NOTHING ELSE IS ASKED FOR ───────────────────────
  // The origin is resolved per lot by the writer, because twelve lots picked
  // off an index came from wherever each of them was standing. A single
  // origin typed here would write a fact that is false for most of them.
  const crate = `Crate ${TAG}`;
  await page.getByPlaceholder("a room, a crate, a courier").fill(crate);
  await page.getByRole("button", { name: "Move 5" }).click();

  // ── AND THE REGISTER AGREES, WHICH IS THE ONLY PROOF THAT COUNTS ─────────
  // The sale's index shows no location on purpose — the movement register is
  // the screen with that column — so the evidence the gesture landed is over
  // there, and this is what makes the two screens one product rather than
  // two.
  await expect(page.getByRole("button", { name: "Move 5" })).toBeHidden({
    timeout: 60_000,
  });
  await page.goto(`${eventUrl}/movement`);
  await expect(page.getByText(crate).first()).toBeVisible();
  await expect(page.getByRole("row", { name: new RegExp(crate) })).toHaveCount(5);
  await page.screenshot({ path: shot("98-lots-moved") });

  // THE SELECTION CANNOT OUTLIVE ITS ROWS. Page two indexes different lots at
  // the same positions, so a run picked on page one must not survive the
  // turn — the component is keyed on the whole query for exactly this.
  await page.goto(eventUrl);
  await boxes.nth(0).click();
  await expect(page.getByText("1 selected")).toBeVisible();
  await page.getByRole("link", { name: "Next ›" }).click();
  await expect(page.getByText(/\d+ selected/)).toBeHidden();
});
