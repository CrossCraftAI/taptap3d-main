// The printed catalogue.
//
// `DFD.md` §6 calls the print PDF "the deliverable that pays for the software
// today", so this asserts against the artefact itself rather than against the
// button that produces it: the bytes are a PDF, it has the page count the engine
// derived, the plates are inside it, and — the part that fails silently
// everywhere else — a CJK font was actually available to the renderer.
//
// A PDF full of tofu boxes is produced SUCCESSFULLY. Nothing upstream errors,
// nothing logs, and it is discovered at the printer's. The font assertion is the
// whole reason this file is not three lines long.

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

function writePng(path: string, w: number, h: number, tint: number): string {
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
      raw[i] = (tint + Math.round(200 * (x / w))) % 256;
      raw[i + 1] = (tint * 2 + Math.round(150 * (y / h))) % 256;
      raw[i + 2] = (tint * 3) % 256;
    }
  }
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
const PLATE = writePng(join(TEMP, `pdf-${RUN}.png`), 400, 300, RUN % 200);
const EVENT = `Print Sale ${RUN}`;
const REF = `Q${RUN}`;

// THE FIRST EXPORT AFTER A COLD START IS SLOW, and the default sixty seconds is
// not enough for it. Chromium's first launch in a fresh container pages in its
// own binary and builds a font cache; afterwards the same export takes about
// four seconds. This ran red once for exactly that reason and the cause looked
// nothing like the truth — so the allowance is written down rather than
// rediscovered. It is also a real operational fact: on a machine that suspends
// when idle, a specialist's first click of the day pays this.
test.describe.configure({ timeout: 240_000 });

test("the catalogue prints, with its plates and its Chinese in it", async ({
  page,
}) => {
  const { eventUrl } = await createEvent(page, EVENT);

  // From the blank editor's canvas, where quick-add lands.
  await page.getByRole("link", { name: "Import lots" }).first().click();
  await page
    .locator("textarea")
    .first()
    .fill(
      `編號\t品名\t作者\t估價\n` +
        `${REF}-1\t青花纏枝蓮紋梅瓶\t佚名\t800,000 – 1,200,000 HKD\n` +
        `${REF}-2\t山水四屏\t張大千\t3,500,000 – 4,800,000 HKD\n` +
        `${REF}-3\t白玉雕螭龍紋佩\t佚名\t180,000 – 260,000 HKD`,
    );
  await page.getByRole("button", { name: "Read this text" }).click();
  await page.getByRole("button", { name: /Import 3 lots/ }).click();
  await page.waitForURL(eventUrl);

  // A plate on the first lot, so the export has an image to carry inline.
  await page.getByRole("link", { name: `${REF}-1` }).first().click();
  await page.waitForURL(/\/lots\//);
  await page.locator('input[type="file"]').setInputFiles([PLATE]);
  await expect(page.locator("figure")).toHaveCount(1, { timeout: 60_000 });

  await page.goto(`${eventUrl}/catalogue`);
  const frame = page.frameLocator('iframe[title="Catalogue preview"]');
  await frame.locator(".page").first().waitFor({ timeout: 30_000 });
  const previewPages = await frame.locator(".page").count();
  await expect(page.getByRole("link", { name: "Download PDF" })).toBeVisible();
  await page.screenshot({ path: shot("20-catalogue-with-pdf"), fullPage: true });

  // ── The artefact ────────────────────────────────────────────────────────
  const response = await page.request.get(`${eventUrl}/catalogue/pdf`, {
    timeout: 180_000,
  });
  expect(response.status(), await response.text().catch(() => "")).toBe(200);
  expect(response.headers()["content-type"]).toContain("application/pdf");

  const body = await response.body();
  expect(body.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  // A PDF with the plate inside it is not a few kilobytes.
  expect(body.byteLength).toBeGreaterThan(20_000);

  const headers = response.headers();
  // ONE ENGINE: the preview and the export paginate identically or the preview
  // is not the deliverable.
  expect(Number(headers["x-taptap3d-pages"])).toBe(previewPages);
  expect(Number(headers["x-taptap3d-lots"])).toBe(3);
  expect(Number(headers["x-taptap3d-plates"])).toBe(1);
  expect(Number(headers["x-taptap3d-plates-dropped"])).toBe(0);

  // THE ONE THAT MATTERS, and it asserts on PAINT rather than on a font name:
  // "TOFU" means 青 came out as the same empty box as a private-use codepoint,
  // which is what a server with no Chinese font produces — successfully, with
  // nothing logged, all the way to the printer.
  expect(headers["x-taptap3d-cjk"]).toBe("rendered");

  // The page tree says how many pages, in the file rather than in a header we
  // wrote ourselves.
  const text = body.toString("latin1");
  const count = /\/Type\s*\/Pages[^>]*?\/Count\s+(\d+)/.exec(text);
  if (count) expect(Number(count[1])).toBe(previewPages);

  // ── What the printer sees ───────────────────────────────────────────────
  // Print media, on the same document the PDF is made from. A screenshot of it
  // is the only artefact here a person can actually check by looking.
  await page.emulateMedia({ media: "print" });
  await page.goto(`${eventUrl}/catalogue/preview`);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: shot("21-print-media"), fullPage: false });
  await page.emulateMedia({ media: null });
});

test("an export says plainly when there is no browser to print with", async ({
  page,
  request,
}) => {
  // Not a hypothetical: it is every developer machine without a Chromium, and
  // the answer has to name the cause rather than surface a library's stack.
  await page.goto("/");
  const first = page.locator("tbody tr a").first();
  await expect(first).toBeVisible();
  await first.click();
  await page.waitForURL(/\/events\//);
  const response = await request.get(`${page.url()}/catalogue/pdf`, {
    timeout: 180_000,
  });
  // Either it printed, or it explained itself. Never a stack trace, never a 500.
  expect([200, 503]).toContain(response.status());
  if (response.status() === 503) {
    expect((await response.json()).error).toMatch(/Chromium/i);
  }
});
