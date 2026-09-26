// The field policy, set through the screen rather than through SQL.
//
// ── WHAT THIS ADDS THAT visibility.spec.ts DOES NOT ─────────────────────────
//
// That spec proves the ENGINE: a house field never reaches a public output,
// and the audience is a property of the output. It writes the policy with an
// UPDATE, deliberately, because its four assertions are about derivation and
// should not depend on whichever control happens to set the column.
//
// This one proves the CONTROL, and the three things that can be wrong with it
// are all invisible to a unit test:
//
//   1. THE FIELD SET IS THE CUSTOMER'S. `保留價` is in no source file and
//      never will be — it arrives at import, inside `lots.fields`, which is
//      open jsonb. A screen that offered a fixed list would look correct in
//      every screenshot and be useless to the house that needs it.
//   2. THE DEFAULT IS THAT NOTHING CHANGES. A house that has said nothing
//      must have an empty column after visiting this screen and pressing
//      Save, not a map of explicit `public`s.
//   3. IT REACHES THE DOCUMENT. A settings screen that writes a row nobody
//      reads is the most convincing kind of broken.
//
// ── IT PUTS THE COLUMN BACK ─────────────────────────────────────────────────
//
// The policy is per-ORG and there is one org in this database, so a spec that
// left one behind would hold a field back from every other spec's catalogue
// and the failures would land in files that never mentioned visibility. The
// restore is through the SCREEN — which is also the last assertion, because
// un-marking a field is the half a whole-map writer can get wrong.

import { expect, test, type Page } from "@playwright/test";

import { createEvent } from "./sale";
import { shot } from "./shots";

const RUN = Date.now();
const EVENT = `Policy Sale ${RUN}`;
const REF = `S${RUN}`;

/**
 * A column of the house's own, and deliberately not `price`.
 *
 * An estimate prints in every catalogue in the trade, so marking it would
 * test the mechanism on the one field whose absence a specialist would read
 * as a bug. `保留價` rather than `底價`: the latter is an alias of the core
 * estimate field (src/lib/import/fields.ts), so the import screen would
 * propose it as the price and this would be testing the importer.
 */
const RESERVE = "保留價";
const RESERVE_VALUE = "750,000 HKD";

/** The select that sets one field's level, found the way a person finds it. */
const levelOf = (page: Page, field: string) => page.getByLabel(field, { exact: true });

test.describe.configure({ timeout: 180_000 });

test("a house sets which of its own fields may leave the building", async ({ page }) => {
  try {
    // ── A sale with a column this system has never heard of ────────────────
    const { eventUrl } = await createEvent(page, EVENT);
    await page.getByRole("link", { name: "Import lots" }).first().click();
    await page
      .locator("textarea")
      .first()
      .fill(`編號\t品名\t估價\t${RESERVE}\n${REF}-1\t青花梅瓶\t800,000 HKD\t${RESERVE_VALUE}`);
    await page.getByRole("button", { name: "Read this text" }).click();
    await page.getByRole("button", { name: /Import 1 lot/ }).click();
    await page.waitForURL(eventUrl);

    // ── The screen is reached from the rail, like every other place ────────
    await page.getByRole("link", { name: /^Settings/ }).click();
    await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();

    // IT SAYS WHOSE ANSWER THIS IS, in the first sentence rather than in a
    // footnote. The mistake it prevents — reading a row as being about the
    // sale you just came from — is the one anybody arriving from a lot
    // record would make.
    await expect(page.getByText(/belong to the whole house/)).toBeVisible();
    await expect(page.getByText(/every catalogue of every sale/)).toBeVisible();

    // ── 1. THE FIELD SET IS THE CUSTOMER'S ─────────────────────────────────
    // The house's own column is offered, and it is offered with the number
    // of lots that carry it, because "how much of my record does this touch"
    // is the question somebody deciding to hide a column actually asks.
    await expect(levelOf(page, RESERVE)).toBeVisible();
    await expect(levelOf(page, RESERVE)).toHaveValue("public");
    // And the nine this system names are there whether or not anything
    // carries them, so a field can be marked before its import arrives.
    await expect(levelOf(page, "估價")).toBeVisible();
    await page.screenshot({ path: shot("70-settings-policy"), fullPage: true });

    // ── 2. SAVING A SCREEN OF DEFAULTS CHANGES NOTHING ─────────────────────
    // The case every org in every database is in today. A screen that stored
    // what its controls said would write forty explicit `public`s here.
    await page.getByRole("button", { name: "Save the policy" }).click();
    await expect(page.getByText(/No field is held back/)).toBeVisible();
    await expect(page.getByText("Never leaves the building")).toHaveCount(0);

    // ── The house makes up its mind ────────────────────────────────────────
    await levelOf(page, RESERVE).selectOption("house");
    await page.getByRole("button", { name: "Save the policy" }).click();
    await expect(page.getByText(/1 field is held back/)).toBeVisible();
    // The badge the lot record shows, here beside the control that set it.
    await expect(page.getByText("Never leaves the building").first()).toBeVisible();
    await page.screenshot({ path: shot("71-settings-marked"), fullPage: true });

    // It survives a reload, which is the difference between a stored answer
    // and a control that only looks like one.
    await page.reload();
    await expect(levelOf(page, RESERVE)).toHaveValue("house");

    // ── 3. IT REACHES THE LOT RECORD AND THE DOCUMENT ──────────────────────
    await page.goto(eventUrl);
    await page.getByRole("link", { name: `${REF}-1`, exact: true }).click();
    await page.waitForURL(/\/lots\//);
    await expect(page.getByText("Never leaves the building").first()).toBeVisible();
    // The record still HOLDS the value — a level is not a deletion, and the
    // people who may see it are the ones looking at this screen.
    await expect(page.getByLabel(RESERVE, { exact: true })).toHaveValue(RESERVE_VALUE);

    await page.getByRole("link", { name: "Open catalogue" }).click();
    // A layout decision, so the catalogue row exists to be derived from.
    await page.getByLabel("Per page").selectOption("2");
    const frame = page.frameLocator('iframe[title="Catalogue preview"]');
    await expect(frame.locator(".page").first()).toBeVisible();
    await expect(frame.locator(`[data-field="${RESERVE}"]`)).toHaveCount(0);
    // The value itself, not only its element: a field dropped from the
    // caption and left in a title attribute would satisfy the count above.
    await expect(frame.locator("body")).not.toContainText("750,000");
    // BOTH ENDS — the rest of the lot is untouched, so this is a withheld
    // field rather than a broken derivation.
    await expect(frame.locator('[data-field="title"]').first()).toContainText("青花梅瓶");
    await page.screenshot({ path: shot("72-settings-catalogue"), fullPage: true });

    // ── 4. A FIELD NOBODY HAS NAMED YET ────────────────────────────────────
    // The direction that cannot leak: mark the column before the import that
    // fills it, so it is held back from the first derivation rather than
    // from the second. Nothing in this database carries this key.
    const unseen = `委託人${RUN}`;
    await page.goto("/settings");
    await page.getByLabel("A field that has not arrived yet").fill(unseen);
    await page.getByLabel("Which readership may have it").selectOption("internal");
    await page.getByRole("button", { name: "Save the policy" }).click();
    await expect(page.getByText(/2 fields are held back/)).toBeVisible();
    // And it is now a row of its own, with the honest count beside it.
    await expect(levelOf(page, unseen)).toHaveValue("internal");
    await expect(page.getByText("no lot carries this now").first()).toBeVisible();
    await page.screenshot({ path: shot("73-settings-named-ahead"), fullPage: true });

    // A name with no level is a refusal in words, not a silent no-op.
    await page.getByLabel("A field that has not arrived yet").fill("未定");
    await page.getByRole("button", { name: "Save the policy" }).click();
    await expect(page.getByText(/Choose which readership/)).toBeVisible();
  } finally {
    // ── 5. UN-MARKING, WHICH IS ALSO THE RESTORE ───────────────────────────
    // The half a whole-map writer gets wrong: an absent key is how "this is
    // public again" is said, and a merge would make it inexpressible. One
    // org, one column, every other spec downstream of it — so this runs
    // whatever happened above.
    await page.goto("/settings");
    for (const select of await page.locator("select[name^='level:']").all()) {
      await select.selectOption("public");
    }
    await page.getByRole("button", { name: "Save the policy" }).click();
    await expect(page.getByText(/No field is held back/)).toBeVisible();
    await expect(page.getByText("Never leaves the building")).toHaveCount(0);
  }
});
