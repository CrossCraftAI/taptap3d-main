// Build a sale worth inspecting, through the product's own paths.
//
// ── WHY THIS EXISTS, AND WHY IT IS NOT IN scripts/seed.ts ───────────────────
//
// `seed.ts` makes the organisation and nothing else, deliberately: "the demo is
// seeded by walking the real onboarding path, so that the path is exercised
// rather than bypassed." This keeps that rule and serves a different need — the
// UI inspection loop has nothing to look at without a sale, and the sales left
// behind by the e2e suite are two lots each.
//
// TWO LOTS IS THE WRONG SUBJECT FOR AN EYE. Every screen in this product is a
// list of a sale's lots, and a list of two is immaculate whatever it does: no
// pagination, no column that runs out of room, no page two, no scroll, and a
// document one sheet long. The house numbers are 100–300 lots a sale with CJK
// titles under twenty characters, so that is what this makes.
//
// Everything here goes through the application: the import screen parses the
// paste, the upload route measures and stores the files, and the assignment
// uses the endpoint the library uses. Nothing is inserted behind the product,
// because a fixture that reaches the database directly can describe a state the
// product cannot produce — and then the inspection is of a page that cannot
// exist.
//
//   node scripts/inspection-sale.mjs --base http://127.0.0.1:3200
//
// It prints the sale's id and the editor's URL for `--routes`.

import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32, deflateSync } from "node:zlib";

const args = process.argv.slice(2);
const base = valueOf("--base") ?? "http://127.0.0.1:3200";
const lotCount = Number(valueOf("--lots") ?? 160);
const plateCount = Number(valueOf("--plates") ?? 28);

function valueOf(flag) {
  const i = args.indexOf(flag);
  return i === -1 ? null : args[i + 1];
}

// Traditional Chinese, because the product is (DFD.md) and because a Latin
// title cannot show what a CJK one does to a caption's line breaking.
const MATERIALS = ["青花", "粉彩", "鬥彩", "白玉", "翡翠", "黃花梨", "紫檀", "銅鎏金", "剔紅", "織錦"];
const FORMS = ["梅瓶", "蓋罐", "觀音尊", "筆筒", "如意", "香爐", "屏風", "掛屏", "冊頁", "手卷"];
const MOTIFS = ["纏枝蓮紋", "雲龍紋", "花鳥紋", "山水人物", "八寶紋", "螭龍紋", "松鶴延年", "嬰戲圖"];

const MAKERS = ["佚名", "景德鎮官窯", "蘇州工", "沈周（傳）", "王時敏", "揚州工"];
const PERIODS = ["明永樂", "明宣德", "清康熙", "清雍正", "清乾隆", "民國"];

/**
 * One field holding a range, which is what an auction estimate IS.
 *
 * Grouped with commas and carrying the currency, because that is the form a
 * house writes it in and the form the caption prints — this system stores the
 * string a person wrote rather than two numbers it would have to re-join.
 */
/** One CSV cell, quoted when it has to be — an estimate carries commas. */
function csv(value) {
  const needsQuotes = value.includes(",") || value.includes('"') || value.includes("\n");
  return needsQuotes ? `"${value.replace(/"/g, '""')}"` : value;
}

function estimateFor(n) {
  const low = 20_000 + ((n * 7919) % 380_000);
  const high = low + 40_000 + ((n * 104_729) % 600_000);
  const grouped = (v) => Math.round(v / 1000) * 1000;
  return `HK$${grouped(low).toLocaleString("en-US")}–${grouped(high).toLocaleString("en-US")}`;
}

function titleFor(n) {
  const m = MATERIALS[n % MATERIALS.length];
  const f = FORMS[(n * 3) % FORMS.length];
  const o = MOTIFS[(n * 7) % MOTIFS.length];
  // Under twenty characters, which is the house's own shape.
  return `${m}${o}${f}`.slice(0, 18);
}

/** A real PNG, made without an image library. See test/e2e/plate.ts. */
function writePlate(path, w, h, tint, seed) {
  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([length, body, crc]);
  };
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
      raw[i + 1] = (tint * 2 + Math.round(140 * (y / h))) % 256;
      raw[i + 2] = (tint * 3 + Math.round(90 * (x / w))) % 256;
    }
  }
  let rest = seed >>> 0;
  for (let i = 0; i < 4; i++) {
    raw[1 + i] = rest & 0xff;
    rest = Math.floor(rest / 256);
  }
  writeFileSync(
    path,
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", ihdr),
      chunk("IDAT", deflateSync(raw)),
      chunk("IEND", Buffer.alloc(0)),
    ]),
  );
  return path;
}

async function main() {
  const run = Date.now();
  // A TWO-CHARACTER SALE TAG ON EVERY REFERENCE, and it is not decoration. The
  // photograph library's assign box searches every lot in the organisation and
  // shows the best twelve — so a bare "001" in a database that has seen a
  // hundred test sales finds eleven other people's lots and not this one's. A
  // real house's references are per-sale anyway ("A12", "L45"), so this is the
  // shape of the thing rather than a workaround.
  const tag = (run % 1296).toString(36).toUpperCase().padStart(2, "0");
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(60_000);

  // ── The sale ──────────────────────────────────────────────────────────────
  // Quick-add, exactly as test/e2e/sale.ts does it and as the demo opens.
  await page.goto(`${base}/`);
  await page.getByLabel("Event name").fill(`明清工藝專場 ${run}`);
  await page.getByRole("button", { name: "Create event" }).click();
  await page.waitForURL(/\/events\/[0-9a-f-]+\/catalogue$/);
  const eventId = page.url().match(/\/events\/([0-9a-f-]{36})/)[1];
  console.log(`sale ${eventId}`);

  // ── The lots, in one paste, the way a consignment arrives ────────────────
  // THE HOUSE'S OWN NINE, and the estimate is ONE field holding a range —
  // which is what src/lib/import/fields.ts says an auction estimate is. The
  // first version of this fixture sent `estimate_low` and `estimate_high` as
  // separate numbers, and the editor printed a column of bare integers under
  // every caption: 27919 over 67919, no currency, no dash. That is not a
  // renderer defect, it is `derive.ts` doing exactly what its note says it does
  // with a custom numeric column — and the inspection is worthless if the
  // document it is looking at was assembled wrongly.
  const rows = ["ref,title,maker,date,material,dimensions,price"];
  for (let n = 1; n <= lotCount; n++) {
    rows.push(
      [
        `${tag}${String(n).padStart(3, "0")}`,
        titleFor(n),
        MAKERS[n % MAKERS.length],
        PERIODS[(n * 5) % PERIODS.length],
        MATERIALS[n % MATERIALS.length],
        `高 ${18 + (n % 30)} 厘米`,
        estimateFor(n),
      ].map(csv).join(","),
    );
  }
  await page.goto(`${base}/events/${eventId}/import`);
  // Cleared then filled, and retried — the hydration race test/e2e/sale.ts
  // measured: a fill that lands before the bundle is listening is reconciled
  // away, and the button stays disabled for ever.
  const box = page.locator("textarea").first();
  const read = page.getByRole("button", { name: "Read this text" });
  for (let attempt = 0; attempt < 15; attempt++) {
    await box.fill("");
    await box.fill(rows.join("\n"));
    if (await read.isEnabled()) break;
    await page.waitForTimeout(1_000);
  }
  await read.click();
  await page.getByRole("button", { name: /Import|Commit/ }).first().click();
  await page.waitForURL(new RegExp(`${eventId}$`));
  console.log(`${lotCount} lots imported`);

  // ── The photographs, uploaded once and filed by the real endpoint ────────
  const files = [];
  for (let i = 0; i < plateCount; i++) {
    // A spread of shapes, because a plate's aspect is what the page has to
    // cope with: portrait vases, square seals, one handscroll.
    const shape =
      i % 9 === 8 ? [2400, 300] : i % 3 === 0 ? [1200, 1600] : i % 3 === 1 ? [1600, 1200] : [1400, 1400];
    files.push(
      writePlate(
        join(tmpdir(), `insp-${run}-${i}.png`),
        shape[0],
        shape[1],
        20 + ((i * 37) % 200),
        run + i * 1_000_003,
      ),
    );
  }
  // WAITED FOR BY NAME, and the first draft is why. `count >= plateCount` over
  // the library's tiles was satisfied the instant the page loaded, because the
  // library holds every photograph this database has ever seen — so the script
  // walked on while the upload was still running, the next navigation cancelled
  // it, and twelve of twenty-eight files were stored. It then reported
  // twenty-eight, because it had counted somebody else's.
  await page.goto(`${base}/photographs?q=insp-${run}-`);
  await page.setInputFiles('input[type="file"]', files);
  await page.waitForFunction(
    (prefix) =>
      Array.from(document.querySelectorAll("main button[aria-pressed] img")).filter((el) =>
        (el.getAttribute("alt") ?? "").startsWith(prefix),
      ).length,
    `insp-${run}-`,
    { timeout: 30_000 },
  );
  await page.waitForFunction(
    ({ prefix, n }) =>
      Array.from(document.querySelectorAll("main button[aria-pressed] img")).filter((el) =>
        (el.getAttribute("alt") ?? "").startsWith(prefix),
      ).length >= n,
    { prefix: `insp-${run}-`, n: plateCount },
    { timeout: 300_000 },
  );
  console.log(`${plateCount} photographs stored`);

  // Filed through the same route the library posts to — an id is checked
  // against the org there, so this is not a back door, it is the front one
  // without the pointer.
  // THE POINTER'S OWN PATH, one photograph at a time. The list of candidate
  // lots only exists while the box has focus (`picking`), so the box is
  // CLICKED and not merely filled — a fill alone sets the value, leaves the
  // list closed, and there is nothing to press.
  for (let i = 0; i < plateCount; i++) {
    const ref = `${tag}${String(i + 1).padStart(3, "0")}`;
    await page.goto(`${base}/photographs?q=${encodeURIComponent(`insp-${run}-${i}.png`)}`);
    const tile = page.getByRole("main").getByRole("button", { name: `insp-${run}-${i}.png` });
    // THROWN, NOT SKIPPED. The first draft continued past a missing tile and
    // then printed "photographs filed" having filed none — a fixture that lies
    // about what it built is worse than one that fails.
    await tile.first().waitFor({ timeout: 20_000 });
    await tile.first().click();
    // The same hydration race as the import box, and for the same reason: this
    // is a controlled input, so a fill that lands before React is listening is
    // reconciled back to the empty string and the list never opens.
    const search = page.getByLabel("Assign to a lot");
    for (let attempt = 0; attempt < 15; attempt++) {
      await search.click();
      await search.fill("");
      await search.fill(ref);
      if ((await search.inputValue()) === ref) break;
      await page.waitForTimeout(500);
    }
    // The rows carry the reference in their own cell, so the row is found by
    // the sale's name beside it rather than by a number that is a substring of
    // a dozen other references.
    const row = page.getByRole("button", { name: new RegExp(ref) });
    await row.first().waitFor({ timeout: 20_000 });
    await row.first().click();
    await page.getByText(/assigned to/).first().waitFor({ timeout: 30_000 });
  }
  console.log("photographs filed");

  console.log(`editor ${base}/events/${eventId}/catalogue`);
  await browser.close();
}

main().catch((error) => {
  console.error("inspection-sale: failed —", error);
  process.exit(1);
});
