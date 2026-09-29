// ONE SALE, THE WHOLE JOB, IN ONE SITTING.
//
// ── WHY THIS EXISTS WHEN EVERY STEP IS ALREADY TESTED ───────────────────────
//
// It is. `pitch.spec.ts` walks the six steps of M1 — shell, create, import,
// match, lots, layout — and every feature since has a spec of its own:
// photographs, polish, condition, movement, the PDF. All of them start from a
// sale they made a moment earlier, exercise their one screen, and stop.
//
// A house does not work that way. A house takes ONE sale from a spreadsheet to
// a printed catalogue over a fortnight, touching every screen, and the defects
// that reach a printer are the ones that live BETWEEN the screens. The three
// worst this revision has found were all of that kind, and not one was visible
// to a per-feature test:
//
//   A GET ADVANCED THE SALE'S STAGE. Opening the editor to look at it filed a
//   status, because the workflow reads a catalogue row as the fact that a sale
//   has been catalogued. Every editor spec passed; they all made their own
//   sale and never looked at the ledger afterwards.
//
//   THE LOT RECORD CONTRADICTED ITSELF BY ONE DRAG. "1 field overridden" at
//   the top and "nothing overridden" ninety pixels below, because the editor
//   writes a `frame` the record's table did not model. Two screens, each
//   correct alone.
//
//   THE POLISH PANEL COVERED THE PLATES IT TREATS. Measured against a desk
//   that only exists when the lots column is closed, which is not how the
//   screen opens.
//
// So this walks one sale forward through the job and then back out of it, and
// asserts the thing a per-feature spec structurally cannot: that what one
// screen did is what the next screen says. Every count it checks is a number
// some OTHER screen produced.
//
// ── IT IS DELIBERATELY NOT A SECOND COPY OF ANYBODY'S ASSERTIONS ────────────
//
// The condition spec proves marks land where they were tapped; this one proves
// that filing a report changes the register's count and the lot's own header.
// Where a step is already pinned in detail elsewhere, this takes the cheapest
// gesture that produces the state and moves on. What it owns is the SEAMS.
//
// Runs against the BUILT application and a real database, one worker.

import { expect, test, type Page } from "@playwright/test";

import { writePlate } from "./plate";
import { createEvent, pasteAndRead } from "./sale";
import { shot } from "./shots";

const RUN = Date.now();
const TAG = `CY${RUN % 100000}`;

const WINDOW = { width: 1440, height: 900 };
test.use({ viewport: WINDOW });

// The whole job in one test. Twelve minutes of budget because it builds a
// sale, uploads plates and renders a PDF — the parts are each a minute and
// the point is that they happen to the same sale.
test.describe.configure({ timeout: 720_000 });

const preview = (page: Page) => page.frameLocator('iframe[title="Catalogue preview"]');

test("a sale goes from a spreadsheet to a printed catalogue, and back out", async ({
  page,
}) => {
  // ── 1. THE HOUSE OPENS A SALE ──────────────────────────────────────────
  const { eventUrl, editorUrl } = await createEvent(page, `Cycle ${RUN}`);
  const eventId = eventUrl.split("/").pop()!;
  await page.screenshot({ path: shot("c1-new-sale") });

  // ── 2. THE CLIENT'S LIST ARRIVES ───────────────────────────────────────
  // Twelve lots: enough for three sheets at four-up, few enough that every
  // later count is checkable by hand.
  const rows = ["ref,title,maker,date,material,price"];
  for (let n = 1; n <= 12; n++) {
    rows.push(
      [
        `${TAG}${String(n).padStart(2, "0")}`,
        `青花纏枝蓮紋梅瓶 ${n}`,
        "景德鎮官窯",
        "清乾隆",
        "青花",
        `"HK$${n}0,000–${n * 2}0,000"`,
      ].join(","),
    );
  }
  await page.goto(`${eventUrl}/import`);
  await pasteAndRead(page, `${rows.join("\n")}\n`);
  await page.getByRole("button", { name: /Import|Commit/ }).first().click();
  await page.waitForURL(new RegExp(`${eventId}$`));

  // THE SEAM: the import wrote rows; the sale's index counts them, and so
  // does the rail. Two readers of one fact, and a spec that only opened the
  // import screen would see neither.
  await expect(page.getByRole("status")).toContainText("of 12");
  await expect(page.getByRole("link", { name: /^All/ })).toContainText("12");
  await expect(page.getByRole("link", { name: /^No photograph/ })).toContainText("12");
  await page.screenshot({ path: shot("c2-lots-imported") });

  // THE SEAM THAT `import_runs` EXISTED FOR AND COULD NOT CLOSE. The table
  // recorded the file, the mapping and the warnings from the moment it was
  // written, and recorded them per EVENT — so it could say what was imported
  // into this sale and never which run produced THIS lot. `drizzle/0006` puts
  // the run and the source row on the lot, and this is the assertion that the
  // commit route actually threads them: the record says which row of which
  // file it came from, and the number is the row a person would find if they
  // opened the spreadsheet.
  //
  // ROW 2, NOT ROW 1 AND NOT POSITION 0. The header is row 1, so the first lot
  // is row 2 — the off-by-one that makes the whole feature useless if it is
  // wrong, and the only way to catch it is to import through the real route.
  await page.goto(`${eventUrl}/lots/${await lotIdOf(page, eventUrl)}`);
  await page.getByRole("tab", { name: "Provenance" }).click();
  await expect(page.getByText("pasted text")).toBeVisible();
  await expect(page.getByText("2 of 12")).toBeVisible();
  // The two senses of the word, side by side and each saying which it is.
  await expect(page.getByRole("heading", { name: "Where the record came from" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Who owned it" })).toBeVisible();
  await page.screenshot({ path: shot("c2b-lot-provenance"), fullPage: true });

  // AND THE RECORD IS PARTITIONED, NOT DUPLICATED. The estimate lives on
  // Financial and nowhere else; a field with two editors is a field whose
  // second save shows a value the first already changed. ONE EDITOR IN THE
  // WHOLE DOCUMENT is the assertion, because both panels are in it at once —
  // a count of two would be the duplication this is here to forbid.
  const estimate = page.getByLabel("估價", { exact: true });
  await expect(estimate).toHaveCount(1);
  await page.getByRole("tab", { name: "Financial" }).click();
  await expect(estimate).toBeVisible();
  await expect(estimate).toHaveValue(/HK\$10,000/);
  await page.getByRole("tab", { name: "Details" }).click();
  // `hidden` and not unmounted, so the value survives the trip — and the
  // panel that is not showing is out of the tab order, which is what `hidden`
  // buys over `aria-hidden`.
  await expect(estimate).toBeHidden();
  await expect(page.getByLabel("品名", { exact: true })).toBeVisible();

  // ── 3. THE PHOTOGRAPHER'S FILES ARRIVE, AND ARE FILED LATER ────────────
  // The two halves of that sentence are the whole design of the library: the
  // plate lands in the house's pile first and is attached to a lot by
  // somebody with the object in front of them.
  const file = writePlate(test.info().outputPath(`${TAG}.png`), 1600, 1200, 60, RUN);
  const name = `${TAG}.png`;
  await page.goto(`/photographs?q=${encodeURIComponent(name)}`);
  const tile = page.getByRole("main").getByRole("button", { name });
  await expect(async () => {
    await page.setInputFiles('input[type="file"]', file);
    await expect(tile).toHaveCount(1, { timeout: 15_000 });
  }).toPass({ timeout: 60_000 });
  await tile.click();
  const search = page.getByLabel("Assign to a lot");
  const ref = `${TAG}01`;
  for (let attempt = 0; attempt < 15; attempt++) {
    await search.click();
    await search.fill("");
    await search.fill(ref);
    if ((await search.inputValue()) === ref) break;
    await page.waitForTimeout(500);
  }
  await page.getByRole("button", { name: new RegExp(ref) }).first().click();
  await expect(page.getByText(new RegExp(`assigned to ${ref}`))).toBeVisible({
    timeout: 60_000,
  });

  // THE SEAM: the library filed it; the sale's index and its filter counts
  // are the ones that have to change, and they are computed on another screen
  // from another query.
  await page.goto(eventUrl);
  await expect(page.getByRole("link", { name: /^No photograph/ })).toContainText("11");
  await page.screenshot({ path: shot("c3-one-plate-filed") });

  // ── 4. THE ENGINE LAYS IT OUT ──────────────────────────────────────────
  await page.goto(editorUrl);
  await expect(preview(page).locator(".page")).toHaveCount(3);
  await expect(page.getByText(/3 pages · 12 lots/)).toBeVisible();

  // ── 5. A PART IS MOVED BY HAND ─────────────────────────────────────────
  // The editor's own gesture, taken at its cheapest: drag a caption and let
  // it commit. place.spec.ts owns what the geometry must be; what this owns
  // is that the LOT RECORD says so afterwards.
  const frame = (await page.locator('iframe[title="Catalogue preview"]').boundingBox())!;
  const title = await preview(page)
    .locator('[data-field="title"]')
    .first()
    .evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    });
  const from = { x: frame.x + title.x + title.w / 2, y: frame.y + title.y + title.h / 2 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 60, from.y + 40, { steps: 12 });
  await page.mouse.up();
  await expect(page.getByText(/1 override/)).toBeVisible({ timeout: 60_000 });

  // ── 6. A PLATE IS TREATED ──────────────────────────────────────────────
  await preview(page).locator('[data-field="images"]').first().click();
  await page.getByRole("tablist", { name: "Selected part" }).waitFor();
  await page.getByRole("button", { name: "底色" }).click();
  await expect(preview(page).locator(".pic--tone").first()).toBeVisible({
    timeout: 60_000,
  });
  await page.screenshot({ path: shot("c4-laid-out-and-polished") });

  // THE SEAM, AND IT IS THE ONE THAT BROKE BEFORE: the drag and the treatment
  // were both written by the editor; the lot's own record is a different
  // screen with a different query, and it used to disagree by one drag.
  await page.goto(eventUrl);
  // ONE LOT, TWO FIELDS, AND BOTH NUMBERS ARE RIGHT. The index's tab counts
  // LOTS this catalogue says something about; the record counts the FIELDS it
  // says something about, and the drag and the treatment landed on two fields
  // of the same lot. The first draft of this test asserted 2 in both places
  // and was wrong in one of them — written down because the next person to
  // read these two screens side by side will have the same thought.
  await expect(page.getByRole("link", { name: /^Overridden/ })).toContainText("1");
  await page.getByRole("link", { name: new RegExp(`${TAG}01`) }).first().click();
  await page.waitForURL(/\/lots\//);
  await expect(page.getByText(/2 fields overridden in the catalogue/)).toBeVisible();
  await page.screenshot({ path: shot("c5-record-agrees") });

  // ── 7. THE OBJECT IS EXAMINED ──────────────────────────────────────────
  // SCOPED TO `main`, AND THE URL CHECKED FOR THE LOT. The rail carries a
  // "Condition" link too — the sale's register — and `.first()` took it, then
  // waited twelve minutes for a form that only exists on the lot. Both paths
  // end in `/condition`, so the URL wait did not catch it either. This is the
  // ambiguity a register and its per-lot copy will always have, and the
  // answer is to say which one.
  await page.getByRole("main").getByRole("link", { name: "Condition" }).first().click();
  await page.waitForURL(/\/lots\/[0-9a-f-]+\/condition$/);
  // The opener's own words. A spec that guesses a label is a spec that fails
  // on a copy change and reads like a broken feature — the first draft here
  // waited twelve minutes for a button called "Examine", which is the verb on
  // the REGISTER's rows, not on the lot's own form.
  // THE EXAMINER IS TYPED, AND THAT IS NOT DECORATION. The action accepts an
  // empty one (condition/actions.ts), so an unfilled form still writes a row —
  // but the field is a controlled input, and filling it is what proves the
  // component has hydrated. Submitting a form nobody is listening to yet was
  // the failure here: the click landed, nothing was written, and the register
  // went on saying 0 of 12.
  const examiner = page.getByLabel("Examined by");
  await expect(async () => {
    await examiner.fill("");
    await examiner.fill("A. Registrar");
    await expect(examiner).toHaveValue("A. Registrar", { timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  await page.getByRole("button", { name: "Open the examination" }).first().click();

  // THE SEAM: the sale's condition register counts examined lots, and its
  // header sentence is derived from a query this screen never ran. Retried
  // over the navigation for place.spec.ts's `SETTLED` reason — a second screen
  // reading a second query after a write it did not make.
  await expect(async () => {
    await page.goto(`${eventUrl}/condition`);
    await expect(page.getByText(/1 of 12 lots examined/)).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 60_000 });
  await page.screenshot({ path: shot("c6-condition-register") });

  // ── 8. THE CRATE GOES TO THE VIEWING ───────────────────────────────────
  // Picked off the index, moved as one gesture — and read back on the
  // register, which is the only screen that shows where a lot is.
  await page.goto(eventUrl);
  const boxes = page.locator('tbody tr[data-lot] input[type="checkbox"]');
  await boxes.first().click();
  await boxes.nth(3).click({ modifiers: ["Shift"] });
  const crate = `Crate ${TAG}`;
  await page.getByPlaceholder("a room, a crate, a courier").fill(crate);
  await page.getByRole("button", { name: "Move 4" }).click();
  await expect(page.getByRole("button", { name: "Move 4" })).toBeHidden({
    timeout: 60_000,
  });
  await expect(async () => {
    await page.goto(`${eventUrl}/movement`);
    await expect(page.getByRole("row", { name: new RegExp(crate) })).toHaveCount(4, {
      timeout: 5_000,
    });
  }).toPass({ timeout: 60_000 });
  await page.screenshot({ path: shot("c7-movement-register") });

  // ── 9. THE CATALOGUE IS PRINTED ────────────────────────────────────────
  // The deliverable. pdf.spec.ts owns what the bytes must contain; this owns
  // that the document a fortnight of work produced is the one that comes out.
  const pdf = await page.request.get(`${eventUrl}/catalogue/pdf`, { timeout: 180_000 });
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()["content-type"]).toContain("application/pdf");
  const bytes = await pdf.body();
  expect(bytes.byteLength).toBeGreaterThan(20_000);
  expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");

  // ── 10. AND BACK OUT, THE WAY A PERSON LEAVES ──────────────────────────
  // Every screen this sale was worked on has a way up that is not the rail —
  // the rail can be put away. walk.mjs reports that over every route; this
  // walks the one journey and proves the ladder holds all the way to the
  // ledger, where the sale is now listed as something that happened.
  await page.goto(`${eventUrl}/lots/${(await lotIdOf(page, eventUrl))}/movement`);
  await page.getByRole("main").getByRole("link", { name: new RegExp(`${TAG}01`) }).first().click();
  await page.waitForURL(/\/lots\/[0-9a-f-]+$/);
  await page.getByRole("main").getByRole("link", { name: new RegExp(`Cycle ${RUN}`) }).first().click();
  await page.waitForURL(new RegExp(`${eventId}$`));
  await page.getByRole("main").getByRole("link", { name: "Events" }).first().click();
  await page.waitForURL(/\/$/);
  // IN `main`, FOR THE THIRD TIME IN THIS SPEC. The switcher's menu carries
  // every sale's name in markup that is closed, so an unscoped `.first()`
  // finds a hidden copy of whatever it is looking for. A journey test walks
  // through the chrome all day; scoping to the page is not a detail here, it
  // is the difference between asserting the screen and asserting the shell.
  await expect(page.getByRole("main").getByText(`Cycle ${RUN}`).first()).toBeVisible();
  await page.screenshot({ path: shot("c8-back-at-the-ledger") });
});

/** The first lot of the sale, by the id its row carries. */
async function lotIdOf(page: Page, eventUrl: string): Promise<string> {
  await page.goto(eventUrl);
  return (await page.locator("tbody tr[data-lot]").first().getAttribute("data-lot"))!;
}
