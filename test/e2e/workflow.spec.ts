// Progress as a column, driven.
//
// The owner rejected a rail that filed a sequence as a menu, and a progress bar
// that would have cost every screen its height. What replaced them is two more
// columns of the ledger — where a sale is, and what to do next — read from facts
// the tables already hold. So this walks ONE sale through every stage of the
// built-in workflow, through the real screens, and asserts at each what the
// ledger says and where its button goes. Then a person overrules the data, the
// ledger says so, and they take it back — because an automatic value a human
// cannot reach is a defect (ARCHITECTURE.md principle 9).
//
// The screenshots are the point. A progress column that is noisy or ambiguous
// fails the first person who sees it, and every assertion here would still pass.

import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { expect, test, type Locator, type Page } from "@playwright/test";

import { writePlate } from "./plate";
import { createEvent } from "./sale";
import { shot } from "./shots";

const TEMP = join("test-results", "fixtures");
mkdirSync(TEMP, { recursive: true });

const RUN = Date.now();
const EVENT = `Staged Sale ${RUN}`;
const REF = `S${RUN}`;
const PLATE_A = writePlate(join(TEMP, `stage-a-${RUN}.png`), 320, 240, RUN % 200);
const PLATE_B = writePlate(join(TEMP, `stage-b-${RUN}.png`), 240, 320, (RUN + 53) % 200);

/** This sale's row on the ledger. The ledger holds every sale ever run here. */
const rowOf = (page: Page): Locator => page.getByRole("row", { name: new RegExp(EVENT) });
/**
 * The ledger showing EVERYTHING, archive included.
 *
 * The ledger defaults to the sales still in production, because a finished one
 * is not what somebody came here to work on. This walk ends with a sale that
 * has been printed, so the last two readings are taken from the tab that holds
 * it — and the default's own behaviour is asserted where the sale crosses over,
 * which is the moment it disappears from the front page.
 */
const archive = (page: Page): Promise<unknown> => page.goto("/?stage=all");
/** The event's header, not the rail and not the ledger. */
const header = (page: Page): Locator => page.locator("main header");

let eventUrl = "";
let eventPath = "";

// The PDF at the end pays Chromium's first launch; see pdf.spec.ts.
test.describe.configure({ timeout: 240_000 });

test("the ledger says where a sale is, and its button says what to do next", async ({
  page,
}) => {
  // ── NEW: a name and nothing else ─────────────────────────────────────────
  ({ eventUrl } = await createEvent(page, EVENT));
  eventPath = new URL(eventUrl).pathname;

  // Quick-add lands on the blank editor, and opening it must NOT have made a
  // catalogue row: the ledger below reads that row as the sale having been
  // catalogued, and a sale that has only been named has not. The event page
  // reads the same stage, and says where it came from.
  await page.goto(eventUrl);
  await expect(page.getByLabel("Stage")).toHaveValue("");
  await expect(page.getByLabel("Stage").locator("option:checked")).toHaveText(
    "New · from the data",
  );

  await page.goto("/");
  await expect(rowOf(page).getByText("New", { exact: true })).toBeVisible();
  const importLots = rowOf(page).getByRole("link", { name: "Import lots" });
  await expect(importLots).toHaveAttribute("href", `${eventPath}/import`);
  await importLots.click();
  await expect(page.getByRole("heading", { name: "Import lots" })).toBeVisible();

  // ── RECORDED: lots in, no photographs ────────────────────────────────────
  await page
    .locator("textarea")
    .first()
    .fill(`編號\t品名\n${REF}-1\t青花瓶\n${REF}-2\t白玉佩`);
  await page.getByRole("button", { name: "Read this text" }).click();
  await page.getByRole("button", { name: /Import 2 lots/ }).click();
  await page.waitForURL(eventUrl);

  // The header's primary action moved on with the sale — it no longer says
  // "Import lots" on a sale whose lots are in. And NOTHING IS GATED: importing
  // more and opening the catalogue are still right there.
  await expect(header(page).getByRole("link", { name: "Add photographs" })).toBeVisible();
  await expect(header(page).getByRole("link", { name: "Import lots" })).toBeVisible();
  await expect(header(page).getByRole("link", { name: "Catalogue" })).toBeVisible();

  await page.goto("/");
  await expect(rowOf(page).getByText("Recorded", { exact: true })).toBeVisible();
  // THE STAGE NAME IS HALF THE CELL. "Recorded" is a state and says nothing
  // about how much of the step is left; the drawing's cell was "Receive · 87
  // without a condition check", and this is that half — derived from the next
  // stage's own conditions, so it is "2 without a photograph" here because the
  // built-in's next stage wants a plate on every lot.
  await expect(rowOf(page).getByText("2 without a photograph")).toBeVisible();
  await expect(rowOf(page).getByRole("link", { name: "Add photographs" })).toHaveAttribute(
    "href",
    "/photographs",
  );
  await page.screenshot({ path: shot("60-ledger-recorded"), fullPage: true });

  // ── PHOTOGRAPHED means EVERY lot. One of two is still Recorded ───────────
  await page.goto(eventUrl);
  await page.getByRole("link", { name: `${REF}-1` }).first().click();
  await page.waitForURL(/\/lots\//);
  await page.locator('input[type="file"]').setInputFiles([PLATE_A]);
  await expect(page.locator("figure")).toHaveCount(1, { timeout: 60_000 });

  await page.goto("/");
  await expect(rowOf(page).getByText("Recorded", { exact: true })).toBeVisible();
  await expect(rowOf(page).getByText("1 / 2")).toBeVisible();
  // THE READING THE BARE LABEL COULD NOT TELL FROM THE ONE ABOVE. Both say
  // "Recorded"; one lot of two now has a plate, and the cell says so in the
  // column where the question was asked rather than two columns away.
  await expect(rowOf(page).getByText("1 without a photograph")).toBeVisible();

  await page.goto(eventUrl);
  await page.getByRole("link", { name: `${REF}-2` }).first().click();
  await page.waitForURL(/\/lots\//);
  await page.locator('input[type="file"]').setInputFiles([PLATE_B]);
  await expect(page.locator("figure")).toHaveCount(1, { timeout: 60_000 });

  await page.goto("/");
  await expect(rowOf(page).getByText("Photographed", { exact: true })).toBeVisible();
  await expect(rowOf(page).getByText("2 / 2")).toBeVisible();
  // Nothing per-lot is outstanding now, so the shortfall moves on with the
  // stage: what the NEXT stage wants is a catalogue, and there is none.
  await expect(rowOf(page).getByText("no catalogues yet")).toBeVisible();
  await expect(rowOf(page).getByText("without a photograph")).toHaveCount(0);
  const openCatalogue = rowOf(page).getByRole("link", { name: "Open catalogue" });
  await expect(openCatalogue).toHaveAttribute("href", `${eventPath}/catalogue`);
  await openCatalogue.click();
  await expect(page.getByRole("heading", { name: "Catalogue" })).toBeVisible();

  // ── LOOKING IS NOT LAYING OUT ────────────────────────────────────────────
  // This test used to read "CATALOGUED: opening it was the fact", and it was
  // right about the code and wrong about the product. Loading the editor called
  // `ensureCatalogue`, the workflow reads a catalogue row as the fact that a
  // sale has been catalogued, and so a GET advanced the stage: a specialist
  // opening a sale to look at it filed a status on the way past. The ledger
  // prints "Nobody files a status, so nobody can forget to" two inches above
  // the row it had just changed.
  //
  // So the assertion is inverted, and this is the guard on the fix: after
  // opening the editor and touching nothing, the sale is still where it was.
  await page.goto("/");
  await expect(rowOf(page).getByText("Photographed", { exact: true })).toBeVisible();
  await expect(rowOf(page).getByText("Catalogued", { exact: true })).toHaveCount(0);

  // ── CATALOGUED: A LAYOUT DECISION IS THE FACT ────────────────────────────
  // Choosing a template is laying out, and it is one of the two gestures that
  // make the row (the other is a pin). One select, and the sale has moved.
  await page.goto(`${eventPath}/catalogue`);
  await page.getByLabel("Template").selectOption("tearsheet");
  // THE SERVER'S ANSWER, NOT THE SELECT'S. The control is optimistic — it holds
  // the new value in local state and posts on a microtask — so asserting its
  // value proves only that the pointer landed, and the `page.goto` on the next
  // line then cancelled the request in flight. The row stayed Photographed and
  // the failure appeared three assertions later, in the ledger, looking like a
  // stage bug.
  //
  // The editor's meta line is rendered from the stored parameters, so it cannot
  // say Tearsheet until the row does. Scoped to the header because "Tearsheet"
  // is also an <option> in the select that was just used.
  await expect(page.locator("header").getByText(/Tearsheet/)).toBeVisible();

  await page.goto("/");
  await expect(rowOf(page).getByText("Catalogued", { exact: true })).toBeVisible();
  // A file, so a plain anchor — but a link to a person all the same.
  await expect(rowOf(page).getByRole("link", { name: "Download PDF" })).toHaveAttribute(
    "href",
    `${eventPath}/catalogue/pdf`,
  );

  // ── EXPORTED: the PDF taken ──────────────────────────────────────────────
  const response = await page.request.get(`${eventUrl}/catalogue/pdf`, {
    timeout: 180_000,
  });
  // A machine with no Chromium explains itself with a 503 (pdf.spec.ts holds
  // that), and a 503 is NOT an export. One with a browser must print.
  if (process.env.PUPPETEER_EXECUTABLE_PATH) expect(response.status()).toBe(200);
  else expect([200, 503]).toContain(response.status());

  if (response.status() === 200) {
    // THE PRINTED SALE LEAVES THE FRONT PAGE. It is archive now: findable, by
    // name or by its own tab, and not what a person opening the ledger came
    // for. This is the one assertion that the default is a filter at all.
    await page.goto("/");
    await expect(rowOf(page)).toHaveCount(0);
    await expect(page.getByRole("link", { name: /^All/ })).toBeVisible();

    await archive(page);
    await expect(rowOf(page).getByText("Exported", { exact: true })).toBeVisible();
    // The last stage's action is still to print: after the export the cycle
    // leaves this system, and sending the file again is what remains.
    await expect(rowOf(page).getByRole("link", { name: "Download PDF" })).toBeVisible();
  } else {
    await page.goto("/");
    await expect(rowOf(page).getByText("Catalogued", { exact: true })).toBeVisible();
  }
  // Every sale this suite has ever made is on this ledger, at whatever stage
  // it stopped — which is what a specialist comparing sixty sales sees.
  await archive(page);
  await page.screenshot({ path: shot("61-ledger-stages"), fullPage: true });

  // ── FOUND BY NAME, WHICHEVER TAB IT IS IN ────────────────────────────────
  // The reason the archive is allowed to be hidden: a sale you can name is one
  // press away, and the address of that search is a link somebody can send.
  await page.goto(`/?q=${encodeURIComponent(EVENT)}&stage=all`);
  await expect(rowOf(page)).toHaveCount(1);
  await page.screenshot({ path: shot("64-ledger-searched"), fullPage: true });
});

test("a person's answer wins over the data, and can be taken back", async ({
  page,
}) => {
  await page.goto(eventUrl);
  const stage = page.getByLabel("Stage");
  await expect(stage).toHaveValue("");
  // The data has this sale at the end; the header's primary action prints.
  await expect(header(page).getByRole("link", { name: "Download PDF" })).toBeVisible();

  // ── SET BY HAND, against the data ────────────────────────────────────────
  // Back to New, on a sale with lots, plates and a catalogue. The person wins.
  await stage.selectOption("new");
  // The server accepted it: the primary action followed the person, so the
  // print button is gone from the header and the import is the one seal.
  await expect(header(page).getByRole("link", { name: "Download PDF" })).toHaveCount(0);
  await expect(header(page).getByRole("link", { name: "Import lots" })).toBeVisible();
  // The control was remounted on the stored answer and reads it back.
  await expect(page.getByLabel("Stage")).toHaveValue("new");
  await expect(page.getByLabel("Stage").locator("option:checked")).toHaveText(
    "New · set by hand",
  );
  await page.screenshot({ path: shot("62-event-stage-set"), fullPage: true });

  // The ledger says so too, and says it was a person — and the counts beside
  // it still tell the truth. Nothing was hidden to make the answer fit.
  await page.goto("/");
  await expect(rowOf(page).getByText("New", { exact: true })).toBeVisible();
  await expect(rowOf(page).getByText("set by hand")).toBeVisible();
  // AND NOTHING IS OUTSTANDING AT THAT STAGE, so the cell says only the name.
  // The step from New to Recorded wants lots, and this sale has two — a sale
  // parked behind its own facts is not a sale with work to do, and inventing
  // a shortfall for it would be the label disagreeing with the data.
  await expect(rowOf(page).getByText(/without a photograph|no \w+ yet/)).toHaveCount(0);
  await expect(rowOf(page).getByRole("link", { name: "Import lots" })).toBeVisible();
  await expect(rowOf(page).getByText("2 / 2")).toBeVisible();
  await page.screenshot({ path: shot("63-ledger-stage-set"), fullPage: true });

  // REMEMBERED: a reload is not a second opinion.
  await page.reload();
  await expect(rowOf(page).getByText("set by hand")).toBeVisible();

  // ── TAKEN BACK, in the same control ──────────────────────────────────────
  await page.goto(eventUrl);
  await page.getByLabel("Stage").selectOption("");
  // The data speaks again: whichever of the last two stages it reads, the
  // action is to print.
  await expect(header(page).getByRole("link", { name: "Download PDF" })).toBeVisible();
  await expect(page.getByLabel("Stage")).toHaveValue("");
  await expect(page.getByLabel("Stage").locator("option:checked")).toHaveText(
    /· from the data$/,
  );

  // The archive, because the data may well have this sale printed by now.
  await archive(page);
  await expect(rowOf(page).getByText("set by hand")).toHaveCount(0);
  await expect(rowOf(page).getByText(/^(Catalogued|Exported)$/)).toBeVisible();
});
