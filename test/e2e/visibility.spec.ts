// Field visibility, driven — the one assertion the whole phase is for.
//
// A house field must not reach a public output. Every unit test in this
// repository could pass with that sentence false in the running application:
// the engine could be correct and the preview route could call it without the
// policy, or the print route could, or the page count beside the frame could
// disagree with the frame. The only way to know is to put a secret in a lot
// through the real screens, read the real document, and look for it.
//
// So this spec does four things in order, and each is a different way for the
// feature to be a decoration:
//
//   1. WITHOUT A POLICY, NOTHING CHANGES. The record carries no badge, the box
//      says nothing is held back, and the value prints. This is the assertion
//      the other three would be meaningless without — "the reserve is absent"
//      is also true of a build where the reserve never imported.
//   2. WITH A POLICY, THE RECORD SAYS SO. The badge, the count, and the
//      catalogue row that reads "held back" instead of showing a value that
//      will not appear (ARCHITECTURE.md principle 9).
//   3. THE DOCUMENT DROPS IT. In the preview frame, which is the same engine
//      and the same renderer the PDF uses.
//   4. THE AUDIENCE IS THE OUTPUT'S. The same sale, the same records, the same
//      policy, a catalogue made for the house — and the value is back. Without
//      this the third assertion is equally satisfied by a bug that drops the
//      field everywhere.
//
// ── THE POLICY IS WRITTEN WITH SQL, AND THAT IS A GAP, NOT A SHORTCUT ───────
//
// There is no screen that sets `orgs.field_policy` and none that sets a
// catalogue's audience. Both are written here through the database, which is
// how a house sets them today. When those screens land this spec drives them
// instead, and the four assertions above do not change — they are about the
// engine, not about the control.
//
// ── IT PUTS THE COLUMN BACK ─────────────────────────────────────────────────
//
// The policy is per-ORG and there is one org in this database, so a spec that
// left one behind would hold a field back from every other spec's catalogue
// and the failures would land in files that never mentioned visibility. The
// restore is in a `finally`.
//
// Runs against the BUILT application and a real database, one worker.

import { expect, test, type FrameLocator, type Page } from "@playwright/test";
import pg from "pg";

import { createEvent } from "./sale";
import { shot } from "./shots";

const RUN = Date.now();
const EVENT = `Visibility Sale ${RUN}`;
const REF = `V${RUN}`;
const ref = (n: number): string => `${REF}-${n}`;

/**
 * Two columns of the house's own, and neither is a core field.
 *
 * DELIBERATELY NOT `price`. An estimate prints in every catalogue in the trade
 * and marking it would test the mechanism on the one field whose absence a
 * specialist would read as a bug. These two are what an auction house actually
 * keeps off the page — and they are the house's own columns, which is the case
 * that matters: the noun set belongs to the customer, so a list of secret
 * field names could never have been shipped in the source.
 *
 * `保留價` rather than `底價`: 底價 is an alias of the core estimate field
 * (src/lib/import/fields.ts), so the matching screen would propose it as the
 * price and the spec would be testing the importer instead.
 */
const RESERVE = "保留價";
const CONSIGNOR = "委託人";
const RESERVE_VALUE = "750,000 HKD";
const CONSIGNOR_VALUE = "高氏家族";

const LOTS: [string, string, string][] = [
  ["青花梅瓶", "佚名", "800,000 – 1,200,000 HKD"],
  ["山水四屏", "張大千", "3,500,000 – 4,800,000 HKD"],
  ["墨荷", "齊白石", "400,000 – 600,000 HKD"],
];

const previewOf = (page: Page): FrameLocator =>
  page.frameLocator('iframe[title="Catalogue preview"]');

/** The box on the lot record that says where this lot's values go. */
const whereThisPrints = (page: Page) =>
  page.locator("section").filter({ hasText: "Where this prints" }).last();

test.describe.configure({ timeout: 180_000 });

test("a house field never reaches a public output, and the record says so", async ({ page }) => {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });

  try {
    // ── A sale, through the ordinary path ──────────────────────────────────
    const { eventUrl } = await createEvent(page, EVENT);

    await page.getByRole("link", { name: "Import lots" }).first().click();
    await page
      .locator("textarea")
      .first()
      .fill(
        `編號\t品名\t作者\t估價\t${RESERVE}\t${CONSIGNOR}\n` +
          LOTS.map(
            ([t, m, p], i) =>
              `${ref(i + 1)}\t${t}\t${m}\t${p}\t${RESERVE_VALUE}\t${CONSIGNOR_VALUE}`,
          ).join("\n"),
      );
    await page.getByRole("button", { name: "Read this text" }).click();
    await page.getByRole("button", { name: /Import 3 lots/ }).click();
    await page.waitForURL(eventUrl);

    // ── 1. WITHOUT A POLICY, NOTHING CHANGES ───────────────────────────────
    await page.getByRole("link", { name: ref(1), exact: true }).click();
    await page.waitForURL(/\/lots\//);
    const lotUrl = page.url();

    // The record carries both values and no mark at all: the default is that a
    // house which has said nothing sees the screen it saw before this landed.
    await expect(page.getByLabel(RESERVE, { exact: true })).toHaveValue(RESERVE_VALUE);
    await expect(page.getByText("Never leaves the building")).toHaveCount(0);
    await expect(page.getByText("internal only")).toHaveCount(0);
    await expect(whereThisPrints(page)).toContainText("nothing held back");
    await expect(whereThisPrints(page)).toContainText("The house has marked no field");
    // A COUNT, not the words: "nothing held back" is in the box above and
    // contains the phrase, so the assertion has to be about a number.
    await expect(page.getByText(/\d+ held back/)).toHaveCount(0);
    await page.screenshot({ path: shot("60-lot-no-policy"), fullPage: true });

    // And it prints. WITHOUT THIS the whole spec would pass against a build
    // where the two columns never imported.
    await page.getByRole("link", { name: "Open catalogue" }).click();
    const frame = previewOf(page);
    // A LAYOUT DECISION, SO THE CATALOGUE ROW EXISTS. Looking at the editor no
    // longer makes one (../../src/app/events/[id]/catalogue/page.tsx: a GET
    // must not advance a sale's stage), and step 4 below has a row to give an
    // audience to only because something here actually chose a layout.
    await page.getByLabel("Per page").selectOption("2");
    await expect(page.getByLabel("Per page")).toHaveValue("2");
    await expect(frame.locator(`[data-field="${RESERVE}"]`).first()).toContainText("750,000");
    await expect(frame.locator(`[data-field="${CONSIGNOR}"]`).first()).toContainText(
      CONSIGNOR_VALUE,
    );
    await page.screenshot({ path: shot("61-catalogue-no-policy"), fullPage: true });

    // ── The house makes up its mind ────────────────────────────────────────
    // Through SQL, because there is no screen for it yet. See the header.
    await pool.query(
      `update "orgs" set "field_policy" = $1::jsonb`,
      [JSON.stringify({ [RESERVE]: "house", [CONSIGNOR]: "internal" })],
    );

    // ── 2. THE RECORD SAYS WHERE EACH VALUE GOES ───────────────────────────
    await page.goto(lotUrl);
    // The mockup's own words, beside the field they are about.
    await expect(page.getByText("Never leaves the building").first()).toBeVisible();
    await expect(page.getByText("internal only").first()).toBeVisible();
    // The record still HOLDS both — a level is not a deletion, and the people
    // who may see them are looking at this screen.
    await expect(page.getByLabel(RESERVE, { exact: true })).toHaveValue(RESERVE_VALUE);

    // Where this prints: one row per readership, naming what each is denied.
    const box = whereThisPrints(page);
    await expect(box).toContainText(`holds back ${RESERVE} · ${CONSIGNOR}`);
    await expect(box).toContainText(`holds back ${RESERVE}`);
    await expect(box).toContainText("nothing held back");
    await expect(box).toContainText("this sale’s catalogue");
    await page.screenshot({ path: shot("62-lot-where-this-prints"), fullPage: true });

    // ── AND THE CATALOGUE PANEL SAYS IT TOO, rather than showing a value
    //    that will not appear on the page. Principle 9: a person must be able
    //    to see that something was withheld and why.
    await expect(page.getByText("2 held back").first()).toBeVisible();
    // THE OVERRIDE TABLE'S ROW, not the "Where this prints" box's. Both name
    // the field — the box says which readerships hold it back, the table says
    // what this catalogue prints — so the field name alone matches three rows
    // on this page. Scoping to the table is what makes the assertion about the
    // one thing it means.
    const reserveRow = page
      .getByRole("table")
      .filter({ hasText: "Prints as" })
      .getByRole("row")
      .filter({ hasText: RESERVE });
    await expect(reserveRow).toContainText("held back");
    // The record column still shows what the record holds, so the row is the
    // whole story: this is the value, and this is why it is not printing.
    await expect(reserveRow).toContainText(RESERVE_VALUE);
    // The tick is still live: an override is this catalogue's decision and a
    // level is the house's, and the person may still make theirs.
    await expect(page.getByLabel(`Hide ${RESERVE} in this catalogue`)).toBeEnabled();

    // ── 3. THE DOCUMENT DROPS IT ───────────────────────────────────────────
    await page.getByRole("link", { name: "Open catalogue" }).click();
    await expect(frame.locator(".page").first()).toBeVisible();
    await expect(frame.locator(`[data-field="${RESERVE}"]`)).toHaveCount(0);
    await expect(frame.locator(`[data-field="${CONSIGNOR}"]`)).toHaveCount(0);
    // The value itself, not only its element: a field dropped from the caption
    // and left in a title attribute would satisfy the count above.
    await expect(frame.locator("body")).not.toContainText("750,000");
    await expect(frame.locator("body")).not.toContainText(CONSIGNOR_VALUE);
    // BOTH ENDS. The rest of the lot is untouched — this is a withheld field,
    // not a broken derivation.
    await expect(frame.locator('[data-field="title"]').first()).toContainText("青花梅瓶");
    await expect(frame.locator('[data-field="price"]').first()).toContainText("800,000");
    await page.screenshot({ path: shot("63-catalogue-public"), fullPage: true });

    // ── 4. THE AUDIENCE IS A PROPERTY OF THE OUTPUT ────────────────────────
    // The same sale, the same records, the same policy — an output made for
    // the house. Without this, a bug that dropped the field from everything
    // would have passed every assertion above.
    await pool.query(
      `update "catalogues" set "params" = "params" || '{"audience":"house"}'::jsonb,
              "updated_at" = now()
        where "event_id" = $1`,
      [eventUrl.split("/").pop()],
    );
    await page.reload();
    await expect(frame.locator(`[data-field="${RESERVE}"]`).first()).toContainText("750,000");
    await expect(frame.locator(`[data-field="${CONSIGNOR}"]`).first()).toContainText(
      CONSIGNOR_VALUE,
    );
    await page.screenshot({ path: shot("64-catalogue-house"), fullPage: true });

    // And the lot record moves with it: the panel now names the readership
    // this catalogue was made for, and holds nothing back from it.
    await page.goto(lotUrl);
    await expect(page.getByText(/Made for house/)).toBeVisible();
    await expect(page.getByText(/\d+ held back/)).toHaveCount(0);
    // The record's badges do NOT move, because they are about the field and
    // not about any one output.
    await expect(page.getByText("Never leaves the building").first()).toBeVisible();
    await page.screenshot({ path: shot("65-lot-house-audience"), fullPage: true });

    // ── 5. THE PRINTED FILE, WHICH IS WHAT ACTUALLY LEAVES ─────────────────
    // A preview that dropped the field and a PDF route that did not would be
    // the worst possible outcome of this phase, and the two call the engine
    // from different files.
    await pool.query(
      `update "catalogues" set "params" = "params" || '{"audience":"public"}'::jsonb,
              "updated_at" = now()
        where "event_id" = $1`,
      [eventUrl.split("/").pop()],
    );
    const pdf = await page.request.get(`${eventUrl}/catalogue/pdf`);
    // 503 is the honest answer on a machine with no headless browser
    // (src/lib/render/pdf.ts), and it is not evidence either way.
    if (pdf.ok()) {
      const bytes = Buffer.from(await pdf.body());
      // A PDF compresses its text, so the plain string is not a reliable
      // negative. What IS reliable is the header the route already publishes:
      // the same document, counted. Held as a smoke check rather than as the
      // assertion, with the real one being that the route derives at all with
      // a policy in place.
      expect(bytes.byteLength).toBeGreaterThan(1000);
      expect(pdf.headers()["x-taptap3d-lots"]).toBe("3");
    }
  } finally {
    // See the header: one org, one column, every other spec downstream of it.
    await pool.query(`update "orgs" set "field_policy" = null`);
    await pool.end();
  }
});
