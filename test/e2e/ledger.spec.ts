// The order of the ledger, driven.
//
// Search, filter and pagination shipped; the order did not, and the result
// count said "newest first" under a list nobody could sort. test/ledger.test.ts
// holds the arithmetic — which sale comes first under each order, where an
// undated one lands, what a stale `?sort=` falls back to — because all of that
// is a pure function of a URL and needs no browser.
//
// What only a browser can say is here: that the control is three real links
// rather than three words, that the one in force is marked, that the order
// survives a search (it rides the plain GET form as a hidden field), and that
// every bit of it works with JavaScript switched off. The last is not a
// nicety — the search on this screen was built as a plain `<form method="get">`
// on the argument that it works before the bundle lands, and an order control
// that quietly needed the bundle would have taken that promise away from the
// screen without anybody noticing.
//
// IT DEPENDS ON THE FIRST TEST HAVING RUN, as workflow.spec.ts does: the count
// sentence is only a sentence when the ledger has rows, so the first test makes
// one. One worker, in file order (playwright.config.ts).

import { expect, test, type Locator, type Page } from "@playwright/test";

import { createEvent } from "./sale";
import { shot } from "./shots";

const RUN = Date.now();
const EVENT = `Ordered Sale ${RUN}`;

/** The order control, which is a navigation and not a form. */
const ordering = (page: Page): Locator =>
  page.getByRole("navigation", { name: "Order the events" });

/** The one line that says what is being shown, and in what order. */
const count = (page: Page): Locator => page.locator("main").getByRole("status");

test("three orders, each of them an address", async ({ page }) => {
  await createEvent(page, EVENT);

  await page.goto("/");
  const nav = ordering(page);
  await expect(nav.getByRole("link")).toHaveCount(3);

  // The default writes nothing down, so the newest is the bare "/" — two URLs
  // must not mean one screen.
  await expect(nav.getByRole("link", { name: "Newest" })).toHaveAttribute("href", "/");
  await expect(nav.getByRole("link", { name: "Soonest" })).toHaveAttribute(
    "href",
    "/?sort=soon",
  );
  await expect(nav.getByRole("link", { name: "Biggest" })).toHaveAttribute(
    "href",
    "/?sort=big",
  );
  await expect(nav.getByRole("link", { name: "Newest" })).toHaveAttribute(
    "aria-current",
    "true",
  );
  await expect(count(page)).toHaveText(/newest first$/);

  await nav.getByRole("link", { name: "Biggest" }).click();
  await expect(page).toHaveURL(/\/\?sort=big$/);
  await expect(ordering(page).getByRole("link", { name: "Biggest" })).toHaveAttribute(
    "aria-current",
    "true",
  );
  // The sentence follows the rows. It used to say "newest first" whatever was
  // true, because nothing else was possible.
  await expect(count(page)).toHaveText(/biggest first$/);
  await page.screenshot({ path: shot("65-ledger-biggest"), fullPage: true });
});

test("the order survives being narrowed, and the narrowing keeps the order", async ({
  page,
}) => {
  await page.goto("/?sort=big");

  // The tab carries it: a specialist looking at the biggest sales still being
  // photographed is one press from the biggest sales at every stage.
  const tabs = page.getByRole("group", { name: "Filter by where an event has got to" });
  await expect(tabs.getByRole("link", { name: /^All/ })).toHaveAttribute(
    "href",
    /sort=big/,
  );

  // And the search carries it, through the hidden field on the plain GET form.
  await page.getByPlaceholder("Find an event by name").fill(EVENT);
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page).toHaveURL(/sort=big/);
  await expect(page).toHaveURL(new RegExp(`q=${encodeURIComponent(EVENT).replace(/%20/g, "\\+")}`));
  await expect(page.getByRole("row", { name: new RegExp(EVENT) })).toHaveCount(1);
});

test.describe("with JavaScript switched off", () => {
  // The screen is server-rendered and every control on it is either a link or
  // a GET form, so all of this is supposed to work with nothing running in the
  // page. Asserted rather than assumed, because the cheapest way to add a sort
  // is a <select> with an onChange, and that would pass every other test here.
  test.use({ javaScriptEnabled: false });

  test("the order is still three links, and the search still carries it", async ({
    page,
  }) => {
    await page.goto("/?sort=big");
    await expect(ordering(page).getByRole("link")).toHaveCount(3);

    await ordering(page).getByRole("link", { name: "Soonest" }).click();
    await expect(page).toHaveURL(/\/\?sort=soon$/);

    await page.getByPlaceholder("Find an event by name").fill(EVENT);
    await page.getByRole("button", { name: "Search" }).click();
    await expect(page).toHaveURL(/sort=soon/);
    await expect(page.getByRole("row", { name: new RegExp(EVENT) })).toHaveCount(1);
    await page.screenshot({ path: shot("66-ledger-order-no-js"), fullPage: true });
  });
});
