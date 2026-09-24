// Movement, driven — and the one claim the whole feature rests on.
//
// "Where it is, is the last movement's destination, and correcting it appends."
// Every unit test in this repository could pass with that sentence false on the
// screen: the derivation is held in test/movement.test.ts, but nothing there
// proves that the bar a registrar reads is wired to it, that the correction
// gesture writes a leg rather than an edit, or that the crate checkbox moves
// what it says it moves.
//
// ARCHITECTURE.md principle 10: "the tests pass" is not evidence that a feature
// works. The screenshots are the deliverable.
//
// NOT RUN IN THE TRANCHE THAT WROTE IT. Several agents share one port and one
// database; this is written to be run by whoever integrates it.

import { expect, test, type Page } from "@playwright/test";

import { createEvent, pasteAndRead } from "./sale";
import { shot } from "./shots";

const RUN = Date.now();
const EVENT = `Movement Sale ${RUN}`;
const REF = `M${RUN}`;
const ref = (n: number): string => `${REF}-${n}`;

/** Four lots, so a crate can hold three of them and leave one behind. */
const LOTS: [string, string][] = [
  ["青花梅瓶", "佚名"],
  ["山水四屏", "張大千"],
  ["白玉佩", "佚名"],
  ["墨荷", "齊白石"],
];

const bar = (page: Page) => page.getByRole("region", { name: "Where it is" });

async function importLots(page: Page, eventUrl: string): Promise<void> {
  await page.goto(`${eventUrl}/import`);
  await pasteAndRead(
    page,
    `編號\t品名\t作者\n` +
        LOTS.map(([t, m], i) => `${ref(i + 1)}\t${t}\t${m}`).join("\n"),
  );
  await page.getByRole("button", { name: /Import 4 lots/ }).click();
  await page.waitForURL(eventUrl);
}

test.describe.configure({ timeout: 180_000 });

test("where it is comes from the chain, and correcting it appends", async ({ page }) => {
  const { eventUrl } = await createEvent(page, EVENT);
  await importLots(page, eventUrl);

  // ── The register: every lot, nowhere recorded ────────────────────────────
  await page.goto(`${eventUrl}/movement`);
  await expect(page.getByRole("heading", { name: "Movement", exact: true })).toBeVisible();
  // A STATE THE MOCKUP NEVER DRAWS. Nobody has said where these are, which is
  // not the same as lost and not the same as "at the house".
  await expect(page.getByText("nowhere recorded").first()).toBeVisible();
  await expect(page.getByText("0 of 4 lots have a chain")).toBeVisible();
  await page.screenshot({ path: shot("50-movement-register-empty"), fullPage: true });

  // ── One lot's chain, from a row ──────────────────────────────────────────
  await page.getByRole("link", { name: ref(1), exact: true }).click();
  await page.waitForURL(/\/lots\/[0-9a-f-]+\/movement$/);
  await expect(page.getByText("Nowhere recorded")).toBeVisible();
  // With no chain the form is already open: there is nothing to correct and
  // exactly one sensible next move.
  await expect(page.getByLabel("To")).toBeVisible();

  await page.getByLabel("To").fill("Photography studio");
  await page.getByLabel("Who has it").fill("K. Ng");
  await page.getByLabel("Why").fill("On receipt from consignor");
  await page.getByRole("button", { name: "Log the movement" }).click();
  await expect(page.getByRole("status").filter({ hasText: /It is at Photography studio/ })).toBeVisible();

  // EXACT, because the bar also carries the status line — "Logged. It is at
  // Photography studio now…" — and a substring match finds the sentence about
  // the place as well as the place. The value is the thing under test.
  // THE BAR READS THE DERIVATION, and says so rather than looking typed in.
  await expect(bar(page).getByText("Photography studio", { exact: true })).toBeVisible();
  await expect(bar(page).getByText(/derived from the last movement/)).toBeVisible();
  await expect(bar(page).getByText(/K\. Ng has it/)).toBeVisible();
  await page.screenshot({ path: shot("51-movement-chain"), fullPage: true });

  // ── The correction appends ───────────────────────────────────────────────
  await page.getByRole("button", { name: "Correct this" }).click();
  // The reason arrives filled in and the caret is in the destination.
  await expect(page.getByLabel("Why")).toHaveValue("Correction");
  await expect(page.getByLabel("To")).toBeFocused();
  await page.getByLabel("To").fill("Warehouse, Kwai Chung");
  await page.getByRole("button", { name: "Log the movement" }).click();

  await expect(bar(page).getByText("Warehouse, Kwai Chung", { exact: true })).toBeVisible();
  // AND NOTHING WAS ERASED. Both legs are in the chain, and the one that was
  // wrong is still readable — which is the whole reason a correction is not an
  // edit.
  const chain = page.getByRole("list").filter({ hasText: "Photography studio" });
  await expect(chain.getByText("Photography studio").first()).toBeVisible();
  await expect(page.getByText(/2 movements/)).toBeVisible();
  await page.screenshot({ path: shot("52-movement-corrected"), fullPage: true });
});

test("a crate is a place, so a group moves in one gesture", async ({ page }) => {
  const { eventUrl } = await createEvent(page, `Crate Sale ${RUN}`);
  await importLots(page, eventUrl);

  // Pack three of the four into a crate, one at a time — there is nobody to
  // move WITH until they are standing together.
  for (const n of [1, 2, 3]) {
    await page.goto(`${eventUrl}/movement`);
    await page.getByRole("link", { name: ref(n), exact: true }).click();
    await page.waitForURL(/\/lots\/[0-9a-f-]+\/movement$/);
    await page.getByLabel("To").fill("Crate HK-114");
    await page.getByLabel("Why").fill("Packed for the saleroom");
    await page.getByRole("button", { name: "Log the movement" }).click();
    await expect(bar(page).getByText("Crate HK-114", { exact: true })).toBeVisible();
  }

  // THE CRATE IS A PLACE ON THE REGISTER, with no special casing anywhere.
  await page.goto(`${eventUrl}/movement`);
  await expect(page.getByText("Where this sale is standing")).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "Crate HK-114" })).toContainText("3");
  await page.screenshot({ path: shot("53-movement-crate"), fullPage: true });

  // ── One gesture moves the crate ──────────────────────────────────────────
  await page.getByRole("link", { name: ref(1), exact: true }).click();
  await page.waitForURL(/\/lots\/[0-9a-f-]+\/movement$/);
  await page.getByRole("button", { name: "Correct this" }).click();
  const group = page.getByLabel(/Move all 3 lots/);
  await expect(group).toBeChecked();
  await page.getByLabel("To").fill("Saleroom, Wong Chuk Hang");
  await page.getByLabel("Why").fill("Pre-sale viewing");
  await page.getByRole("button", { name: "Log the movement" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: /Logged for 3 lots in one gesture/ }),
  ).toBeVisible();
  // The leg says how many travelled with it, derived from the instant they
  // share rather than from a batch id.
  await expect(page.getByText(/moved with 2 more/)).toBeVisible();

  // And the crate is empty, because membership was never stored.
  await page.goto(`${eventUrl}/movement`);
  await expect(page.getByRole("listitem").filter({ hasText: "Crate HK-114" })).toHaveCount(0);
  await expect(page.getByRole("listitem").filter({ hasText: "Saleroom, Wong Chuk Hang" })).toContainText("3");
  // The fourth lot never moved and still says so — in the row, AND in the
  // register's own count, which is the pair worth holding: the meta line is a
  // summary of the rows and the two disagreeing is the defect a summary has.
  // (The bare text matched both, which is why this says which it means.)
  await expect(page.getByText("1 nowhere recorded")).toBeVisible();
  await expect(
    page.getByRole("cell").filter({ hasText: "nowhere recorded" }),
  ).toHaveCount(1);
  await page.screenshot({ path: shot("54-movement-crate-moved"), fullPage: true });
});

test("one chain, two audiences: a public leg becomes provenance", async ({ page }) => {
  const { eventUrl } = await createEvent(page, `Provenance Sale ${RUN}`);
  await importLots(page, eventUrl);

  await page.goto(`${eventUrl}/movement`);
  await page.getByRole("link", { name: ref(1), exact: true }).click();
  await page.waitForURL(/\/lots\/[0-9a-f-]+\/movement$/);

  await page.getByLabel("To").fill("Photography studio");
  await page.getByLabel("Why").fill("On receipt from consignor");
  await page.getByRole("button", { name: "Log the movement" }).click();
  await expect(bar(page).getByText("Photography studio", { exact: true })).toBeVisible();

  // The first leg came from outside the house, so there is no holder to name
  // and the tick is refused rather than offered and ignored.
  await expect(page.getByRole("button", { name: "Internal" })).toBeDisabled();
  await expect(page.getByText(/Mark a leg public/)).toBeVisible();

  // A second leg has an origin this system knows.
  await page.getByRole("button", { name: "Correct this" }).click();
  await page.getByLabel("To").fill("Warehouse, Kwai Chung");
  await page.getByLabel("Why").fill("Return after photography");
  await page.getByRole("button", { name: "Log the movement" }).click();

  // THE BUTTON ON THE LEG THAT HAS AN ORIGIN, named rather than positional.
  // `.first()` is the newest leg only once the newest leg has rendered, and
  // the click binds before the revalidation lands — so it latched onto the
  // arrival-from-outside below it and waited for a button that is disabled on
  // purpose to become enabled. Waiting for the leg by its own words is both
  // the fix and the assertion that the second leg exists at all.
  const returnLeg = page
    .getByRole("listitem")
    .filter({ hasText: "Photography studio → Warehouse, Kwai Chung" });
  await expect(returnLeg).toHaveCount(1);
  await returnLeg.getByRole("button", { name: "Internal" }).click();
  await expect(returnLeg.getByRole("button", { name: "Public as provenance" })).toBeVisible();
  // AND THE BOX BELOW IS WHAT THE CATALOGUE WOULD PRINT — the same function,
  // not a second description of it.
  await expect(page.getByText(/Photography studio, until 20\d\d/)).toBeVisible();
  await page.screenshot({ path: shot("55-movement-provenance"), fullPage: true });

  // Reversible in the control that set it (principle 9).
  await returnLeg.getByRole("button", { name: "Public as provenance" }).click();
  await expect(page.getByText(/Mark a leg public/)).toBeVisible();
});
