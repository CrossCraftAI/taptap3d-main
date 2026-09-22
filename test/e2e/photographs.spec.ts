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

import { expect, test } from "@playwright/test";

import { createEvent } from "./sale";
import { shot } from "./shots";

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
  const before = await page.locator("button[aria-pressed]").count();
  await page.locator('input[type="file"]').setInputFiles([PHOTO_A, PHOTO_B]);
  await expect(page.locator("button[aria-pressed]")).toHaveCount(before + 2, {
    timeout: 60_000,
  });

  // They are HELD and visibly UNFILED — a state, not a failure.
  await expect(page.getByText("unassigned").first()).toBeVisible();
  // Measured on the way in, so the engine never renders anything to learn a
  // plate's aspect.
  await expect(page.getByText("240 × 180").first()).toBeVisible();
  await page.screenshot({ path: shot("11-photographs-unassigned"), fullPage: true });

  // ── Filed later, by someone with the objects in front of them ───────────
  await page.goto("/photographs?filter=unassigned");
  const cards = page.locator("button[aria-pressed]");
  await cards.first().click();
  // Shift extends the run, the way every file manager does.
  await cards.nth(1).click({ modifiers: ["Shift"] });
  await expect(page.getByText(/^\d+ selected$/)).toBeVisible();
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
  // Nobody was asked to choose a plate; the first photograph became one, or the
  // catalogue renders a lot that has pictures and shows none.
  await expect(page.getByText("plate", { exact: true })).toBeVisible();
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
  await expect(page.getByText("plate", { exact: true })).toBeVisible();

  await page.goto("/photographs");
  await expect(page.locator("button[aria-pressed]")).toHaveCount(before + 2);
});

test("a lot takes a photograph dropped straight onto it", async ({ page }) => {
  await page.goto(eventUrl);
  await page.getByRole("link", { name: REF_B }).first().click();
  await page.waitForURL(/\/lots\//);

  await expect(page.getByText("No photograph on this lot yet.")).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles([PHOTO_C]);
  await expect(page.locator("figure")).toHaveCount(1, { timeout: 60_000 });
  await expect(page.getByText("plate", { exact: true })).toBeVisible();
  await page.screenshot({ path: shot("15-lot-direct-upload"), fullPage: true });

  // It attached here AND stayed in the library — nothing is trapped inside one
  // lot, which is the whole reason the library exists separately.
  await page.goto("/photographs?filter=assigned");
  await expect(page.getByText(/on 1 lot/).first()).toBeVisible();
});
