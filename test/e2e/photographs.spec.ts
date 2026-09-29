// Photographs arrive first, and get filed later.
//
// The whole point of the asset model is that these are two separate moments, so
// the test keeps them separate: upload with no lot in mind, confirm the
// photographs are held and visibly unfiled, and only then assign them. A test
// that uploaded straight onto a lot would pass without ever exercising the state
// the design exists for.
//
// ── THE FIXTURES ARE UNIQUE PER RUN, AND THAT IS NOT INCIDENTAL ─────────────
//
// The store is content-addressed, so re-uploading the same bytes stores nothing
// and creates no row — correctly. A committed fixture therefore passes on a
// fresh database and fails on the second run against the same one, which reads
// as a broken upload and is really a working deduplicator. The images are built
// here with a run-unique tint, so "two more photographs appeared" stays a true
// statement about a database that already holds a thousand.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { crc32, deflateSync } from "node:zlib";

import { expect, test, type Page } from "@playwright/test";

import { PAGE_SIZE } from "@/lib/photographs";

import { createEvent } from "./sale";
import { shot } from "./shots";

/**
 * The library's tiles, and the scope is the point.
 *
 * `button[aria-pressed]` was the whole document, and the rail grew a
 * width toggle that carries the same attribute — so the count was one over
 * everywhere, and the sentence "Showing 1–48" was compared against 49 tiles
 * that were 48 tiles and a chrome control. Scoped to `main`, which the rail
 * is not in.
 */
const tilesOf = (page: Page) => page.getByRole("main").locator("button[aria-pressed]");

/**
 * How many photographs the house holds, read off the count the screen prints.
 *
 * NOT THE TILES. The grid is a page of at most `PAGE_SIZE`, so on any library
 * with more than that in it, uploading two more changes the total and leaves
 * the tile count exactly where it was. Counting tiles to prove an upload
 * landed asserts the page size and nothing else.
 */
async function heldBy(page: Page): Promise<number> {
  // TOTAL over the empty state too. A query that matches nothing prints its
  // own sentence instead of a count, so waiting for "Showing" there hangs for
  // the whole test timeout and reports the wait rather than the emptiness.
  const line = page.getByText(/^Showing /);
  if ((await line.count()) === 0) return 0;
  const text = (await line.first().textContent()) ?? "";
  return Number(/of ([\d,]+)/.exec(text)?.[1]?.replace(/,/g, "") ?? "0");
}

const TEMP = join("test-results", "fixtures");
mkdirSync(TEMP, { recursive: true });

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([length, body, crc]);
}

/**
 * A real, valid, 8-bit truecolour PNG — not a magic number with a name.
 *
 * THE RUN IS WRITTEN INTO THE PIXELS, not only into the tint. The tint is
 * `RUN % 200`, which is two hundred buckets: with twenty-seven runs already in
 * the store, a fresh run had roughly one chance in four of producing bytes
 * identical to an earlier morning's — and it did, at 186. The store then did
 * its job, kept nothing, and this spec read a working deduplicator as a broken
 * upload for a minute, exactly the failure the header above describes. So the
 * full millisecond timestamp goes into the first row's channel values, where
 * it changes the bytes and nothing anybody looks at.
 */
function writePng(path: string, w: number, h: number, tint: number, seed: number): string {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    const row = y * (1 + w * 3);
    for (let x = 0; x < w; x++) {
      const i = row + 1 + x * 3;
      raw[i] = (tint + Math.round(180 * (x / w))) % 256;
      raw[i + 1] = (tint * 3 + Math.round(120 * (y / h))) % 256;
      raw[i + 2] = (tint * 7) % 256;
    }
  }
  // After the first row's filter byte. Thirteen digits into the first four
  // pixels and a channel; the row is far wider than that.
  Buffer.from(String(seed), "ascii").copy(raw, 1);
  writeFileSync(
    path,
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      pngChunk("IHDR", ihdr),
      pngChunk("IDAT", deflateSync(raw)),
      pngChunk("IEND", Buffer.alloc(0)),
    ]),
  );
  return path;
}

const RUN = Date.now();
const tint = RUN % 200;
const PHOTO_A = writePng(join(TEMP, `a-${RUN}.png`), 240, 180, tint, RUN);
const PHOTO_B = writePng(join(TEMP, `b-${RUN}.png`), 180, 240, tint + 37, RUN);
const PHOTO_C = writePng(join(TEMP, `c-${RUN}.png`), 200, 200, tint + 71, RUN);

const EVENT = `Photograph Sale ${RUN}`;
// RUN-UNIQUE REFERENCES. Lot references repeat across sales in real life — two
// events both having an "A01" is ordinary, which is why the picker prints the
// event name beside each row. It also means a test that types "A01" reaches
// whichever A01 sorted first, including one a previous run left behind, and
// then asserts against the wrong lot.
const REF_A = `R${RUN}A`;
const REF_B = `R${RUN}B`;
let eventUrl = "";

test("photographs arrive unassigned, and are filed when someone gets to it", async ({
  page,
}) => {
  // ── A sale with two lots, through the ordinary path ──────────────────────
  ({ eventUrl } = await createEvent(page, EVENT));

  await page.getByRole("link", { name: "Import lots" }).first().click();
  await page
    .locator("textarea")
    .first()
    .fill(`編號\t品名\n${REF_A}\t青花瓶\n${REF_B}\t白玉佩`);
  await page.getByRole("button", { name: "Read this text" }).click();
  await expect(page.getByRole("heading", { name: /2 lots will be created/ })).toBeVisible();
  await page.getByRole("button", { name: /Import 2 lots/ }).click();
  await page.waitForURL(eventUrl);

  // ── The library ──────────────────────────────────────────────────────────
  await page.getByRole("link", { name: /^Photographs/ }).click();
  await expect(page.getByRole("heading", { name: "Photographs" })).toBeVisible();
  await page.screenshot({ path: shot("10-photographs-library"), fullPage: true });

  // ── Upload, with no lot in mind ──────────────────────────────────────────
  const before = await heldBy(page);
  await page.locator('input[type="file"]').setInputFiles([PHOTO_A, PHOTO_B]);
  // THE HOUSE HOLDS TWO MORE, which is what an upload means. The grid shows a
  // page, so on a library already past that page the tile count cannot move
  // and asserting it would be asserting `PAGE_SIZE`.
  await expect
    .poll(() => heldBy(page), { timeout: 60_000 })
    .toBe(before + 2);
  // And they are on the first page, because the order is newest first — which
  // is the half that makes the upload usable rather than merely recorded.
  await expect(page.getByText(`a-${RUN}.png`).first()).toBeVisible();
  await expect(page.getByText(`b-${RUN}.png`).first()).toBeVisible();

  // They are HELD and visibly UNFILED — a state, not a failure.
  await expect(page.getByText("unassigned").first()).toBeVisible();
  // Measured on the way in, so the engine never renders anything to learn a
  // plate's aspect.
  await expect(page.getByText("240 × 180").first()).toBeVisible();
  await page.screenshot({ path: shot("11-photographs-unassigned"), fullPage: true });

  // ── Filed later, by someone with the objects in front of them ───────────
  await page.goto("/photographs?filter=unassigned");
  const cards = tilesOf(page);
  await cards.first().click();
  // Shift extends the run, the way every file manager does. The bar says "on
  // this page" once there is more than one, because the library is paged now
  // and a selection that spanned pages would report a number over a grid that
  // does not show them — so the sentence has two shapes and the match takes
  // both rather than pinning the one it happened to see.
  await cards.nth(1).click({ modifiers: ["Shift"] });
  await expect(page.getByText(/^\d+ selected( on this page)?$/)).toBeVisible();
  await page.screenshot({ path: shot("12-photographs-selected"), fullPage: true });

  await page.getByLabel("Assign to a lot").fill(REF_A);
  await page.getByRole("button", { name: new RegExp(REF_A) }).first().click();
  await expect(page.getByText(new RegExp(`assigned to ${REF_A}`))).toBeVisible({
    timeout: 60_000,
  });
  await page.screenshot({ path: shot("13-photographs-assigned"), fullPage: true });

  // ── And they are on the lot, with one of them the plate ─────────────────
  await page.goto(eventUrl);
  await page.getByRole("link", { name: REF_A }).first().click();
  await page.waitForURL(/\/lots\//);
  await expect(page.getByRole("heading", { name: new RegExp(REF_A) })).toBeVisible();
  // THE PHOTOGRAPHS ARE A TAB OF THE RECORD NOW. The lot's four tabs are
  // Details, Financial, Images and Provenance, and the tab carries the count
  // — so the press is also the assertion that the header agrees with what is
  // behind it.
  await expect(page.getByRole("tab", { name: /^Images/ })).toContainText("2");
  await page.getByRole("tab", { name: /^Images/ }).click();
  // Nobody was asked to choose a plate; the first photograph became one, or the
  // catalogue renders a lot that has pictures and shows none.
  //
  // THE CHIP ON THE PHOTOGRAPH, not the word. "plate" is also the label of a
  // row in the override table below — it is a field this catalogue can hide —
  // and that table now renders on every lot rather than only on a sale whose
  // catalogue row happened to exist, so the bare text matches twice. Scoping
  // to the figure is what the assertion always meant.
  await expect(page.locator("figure").getByText("plate", { exact: true })).toBeVisible();
  const figures = await page.locator("figure").count();
  expect(figures).toBeGreaterThanOrEqual(2);
  await page.screenshot({ path: shot("14-lot-detail"), fullPage: true });

  // ── Removing takes it off the lot, not out of the library ───────────────
  const heldBefore = await page.evaluate(async () => {
    const response = await fetch("/photographs", { headers: { accept: "text/html" } });
    return response.ok;
  });
  expect(heldBefore).toBe(true);

  await page.getByRole("button", { name: "Remove" }).first().click();
  await expect(page.locator("figure")).toHaveCount(figures - 1, { timeout: 60_000 });
  // Still a plate on the lot: detaching the plate hands it to the next
  // photograph rather than leaving a lot with pictures and nothing to print.
  // Scoped to the figure for the same reason as above.
  await expect(page.locator("figure").getByText("plate", { exact: true })).toBeVisible();

  await page.goto("/photographs");
  // The house still holds them both. Counting tiles here would assert the page
  // size, not the upload — see `heldBy`.
  expect(await heldBy(page)).toBe(before + 2);
});

test("the library is a page of what the query asks for", async ({ page }) => {
  // ── WHAT THIS IS FOR, IN TWO NUMBERS ─────────────────────────────────────
  //
  // The library rendered every tile the house held into one document. Measured
  // against a production build with 424 photographs in the org: 1,475,396
  // bytes of served HTML, 775 of them per tile, taken as the median distance
  // between two consecutive `/api/assets/` markers in the response — the way
  // src/lib/nav.ts measured the switcher's rows.
  //
  // A driven test cannot assert a byte count that moves with the data, so it
  // asserts the thing that produced it: the grid draws a bounded number of
  // tiles however many the house holds, what it does not draw is reachable,
  // and every control is an address somebody can send.
  //
  // ── AND WHAT THE PAGER DID TO THE SELECTION ──────────────────────────────
  //
  // Shift-click extends across what is on screen, and a pager changes what
  // that means. The choice was that the selection IS what is on screen, and
  // the last block here is that sentence as an assertion — because the way it
  // silently goes wrong is a client-side navigation that re-renders the page
  // without remounting the grid, leaving eleven photographs selected over
  // tiles that no longer contain them.
  await page.goto("/photographs");
  await expect(page.getByRole("heading", { name: "Photographs" })).toBeVisible();

  const tiles = tilesOf(page);
  const count = await tiles.count();
  const pager = page.getByRole("navigation", { name: "Pages of the library" });
  const shown = page.getByText(/^Showing /);

  // THE COUNT SAYS WHAT IS SHOWN OF WHAT EXISTS, and the two halves have to
  // agree with the tiles actually in the document — a sentence that says 48
  // over a grid of 424 is worse than no sentence.
  await expect(shown).toContainText(new RegExp(`Showing 1–${count} of `));
  await page.screenshot({ path: shot("16-photographs-page-one"), fullPage: true });

  if (await pager.isVisible()) {
    // More than a page's worth. The tiles on page two are not the tiles on
    // page one — which is the only thing a pager has to get right, and the
    // thing an unstable sort gets wrong by repeating a row across two pages.
    const first = await tiles.first().innerText();
    await pager.getByRole("link", { name: /Next/ }).click();
    await expect(page).toHaveURL(/page=2/);
    await expect(shown).toContainText(new RegExp(`Showing ${count + 1}–`));
    await expect(pager).toContainText("Page 2 of");
    expect(await tiles.first().innerText()).not.toBe(first);
    await page.screenshot({ path: shot("17-photographs-page-two"), fullPage: true });

    // A stale link to a page past the end shows the last page rather than an
    // empty grid: the photographs are what somebody came for and the page
    // number was never the point.
    await page.goto("/photographs?page=9999");
    await expect(tiles.first()).toBeVisible();
    await expect(pager).not.toContainText("Page 9999");
  } else {
    // A house with less than a page's worth has no pager at all — a control
    // whose only outcome is staying put is the dead control this suite is
    // under standing instruction to refuse.
    await expect(pager).toHaveCount(0);
  }

  // ── THE SEARCH IS A PLAIN GET FORM, so it is an address ──────────────────
  //
  // THE RUN IS IN THE TERM, and that is the same care the fixtures at the top
  // of this file take. Searching "a-" would also find every earlier morning's
  // `a-<run>.png` still in the store, so the count below would depend on how
  // many times anybody had run this suite — and the tab assertion after it
  // would be measuring the database's history rather than the product.
  await page.goto("/photographs");
  await page.getByPlaceholder("Find a photograph by filename").fill(`a-${RUN}`);
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page).toHaveURL(new RegExp(`[?&]q=a-${RUN}`));
  // The fixtures this file uploads are named `a-<run>.png` and `b-<run>.png`,
  // so this finds one of them and not the other.
  await expect(page.getByText(`a-${RUN}.png`).first()).toBeVisible();
  await expect(page.getByText(`b-${RUN}.png`)).toHaveCount(0);
  await page.screenshot({ path: shot("18-photographs-search"), fullPage: true });

  // THE TABS COUNT WHAT THE SEARCH LEFT, not what the house holds. A tab
  // reading "12" that lands on an empty grid is the defect a faceted count
  // exists to prevent, and it is invisible until somebody presses it.
  const onALot = page.getByRole("link", { name: /^On a lot/ });
  const promised = Number((await onALot.innerText()).match(/(\d+)\s*$/)?.[1] ?? "-1");
  await onALot.click();
  await expect(page).toHaveURL(/filter=assigned/);
  // The search rides along with the filter — searching inside a pile stays
  // in that pile — so the grid is what the tab promised.
  await expect(page).toHaveURL(new RegExp(`[?&]q=a-${RUN}`));
  // What the tab promised, up to one page of it. The promise is about the
  // whole filtered set and the grid shows a page, so the two agree only while
  // the set fits — which is the honest comparison and the one that keeps
  // working when this search matches more than forty-eight.
  await expect(tilesOf(page)).toHaveCount(Math.min(promised, PAGE_SIZE));
  expect(await heldBy(page)).toBe(promised);

  // A word that is in no filename says so, and offers the two presses that
  // undo it: a state the mockup never draws and the product must.
  await page.getByPlaceholder("Find a photograph by filename").fill("nothing is called this");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.getByText(/No photograph here is named/)).toBeVisible();
  await page.screenshot({ path: shot("19-photographs-no-hits"), fullPage: true });
  await page.getByRole("link", { name: "Look at every photograph" }).click();
  await expect(page).toHaveURL(/\/photographs$/);

  // ── THE SELECTION IS WHAT IS ON SCREEN ───────────────────────────────────
  await page.goto("/photographs");
  await tilesOf(page).first().click();
  await expect(page.getByText(/^1 selected/)).toBeVisible();
  // Any navigation that changes the query clears it, because what the Assign
  // button writes must be what a person can see.
  await page.getByRole("link", { name: /^Unassigned/ }).click();
  await expect(page.getByText(/selected/)).toHaveCount(0);
});

test("a lot takes a photograph dropped straight onto it", async ({ page }) => {
  await page.goto(eventUrl);
  await page.getByRole("link", { name: REF_B }).first().click();
  await page.waitForURL(/\/lots\//);

  // Images is a tab of the record; the dropzone is behind it.
  await page.getByRole("tab", { name: /^Images/ }).click();
  await expect(page.getByText("No photograph on this lot yet.")).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles([PHOTO_C]);
  await expect(page.locator("figure")).toHaveCount(1, { timeout: 60_000 });
  // The chip, not the override table's row of the same name — see line 156.
  await expect(page.locator("figure").getByText("plate", { exact: true })).toBeVisible();
  await page.screenshot({ path: shot("15-lot-direct-upload"), fullPage: true });

  // It attached here AND stayed in the library — nothing is trapped inside one
  // lot, which is the whole reason the library exists separately.
  await page.goto("/photographs?filter=assigned");
  await expect(page.getByText(/on 1 lot/).first()).toBeVisible();
});
