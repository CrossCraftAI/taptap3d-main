// The screens that only exist once somebody has done something.
//
// ── WHY THE STATIC SWEEP CANNOT SEE ANY OF THIS ─────────────────────────────
//
// scripts/inspect.mjs loads a URL and measures what renders. Every control in
// the editor appears in response to a GESTURE and has no address: the polish
// panel mounts on a selection, the floating toolbar is positioned relative to
// the part under the pointer, the rail's icon width is a stored preference, and
// the library's assign bar exists only while photographs are picked. A route
// that renders none of them cannot overflow, cannot clip and cannot be ugly —
// so a clean static run over this product is a clean run over its empty states.
//
// This drives each one and takes the photograph. It asserts almost nothing on
// purpose: the eye is the instrument here, and test/e2e is where behaviour is
// held. What it must do is FAIL LOUDLY when a gesture does not land, because a
// screenshot of a panel that never opened looks exactly like a screenshot of a
// screen that does not need one.
//
//   node scripts/inspect-driven.mjs --base http://127.0.0.1:3200 --event <id>

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const base = valueOf("--base") ?? "http://127.0.0.1:3200";
const eventId = valueOf("--event");
const out = valueOf("--out") ?? "ui-inspect-driven";
const WINDOW = { width: 1440, height: 900 };

function valueOf(flag) {
  const i = args.indexOf(flag);
  return i === -1 ? null : args[i + 1];
}

if (!eventId) {
  console.error("inspect-driven: --event <id> is required (scripts/inspection-sale.mjs prints one).");
  process.exit(1);
}

const shots = [];

async function shot(page, name) {
  const path = join(out, `${name}.png`);
  await page.screenshot({ path });
  shots.push(path);
  console.log(`shot  ${name}`);
}

async function main() {
  mkdirSync(out, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: WINDOW });
  page.setDefaultTimeout(60_000);

  const failures = [];
  const watch = (what, promise) =>
    promise.catch((error) => {
      failures.push(`${what}: ${error.message.split("\n")[0]}`);
    });

  // ── The editor, with a part selected ──────────────────────────────────────
  const editor = `${base}/events/${eventId}/catalogue`;
  await page.goto(editor);
  const preview = page.frameLocator('iframe[title="Catalogue preview"]');
  await preview.locator(".page").first().waitFor();
  await shot(page, "01-editor-at-rest");

  // A PLATE, because the polish panel's whole vocabulary is about photographs
  // and a caption selection shows the disabled tab instead.
  await watch(
    "select a plate",
    (async () => {
      await preview.locator('[data-field="images"]').first().click();
      await page.getByRole("tablist", { name: "Selected part" }).waitFor();
    })(),
  );
  await shot(page, "02-editor-plate-selected");

  await watch(
    "the polish tab",
    (async () => {
      // ── RESET FIRST, BECAUSE THE GROUND BUTTONS TOGGLE ──────────────────
      //
      // Pressing a ground that is already chosen turns it OFF. That is the
      // right behaviour for a person and the wrong assumption for a script:
      // the second run of this harness against the same sale found the plate
      // already toned from the first, cleared it, and then reported the
      // feature broken. It alternated pass, fail, pass, fail — which is worse
      // than failing, because half the runs say everything is fine.
      //
      // A harness that only works on a virgin fixture lies on every run after
      // the first. This starts from a known plate.
      const clear = page.getByRole("button", { name: "原狀" });
      if (await clear.isEnabled().catch(() => false)) {
        await clear.click();
        // WAITED FOR ON THE PANEL, NOT ON THE PREVIEW. The frame is double
        // buffered, so the old plate's element detaches the instant a reload
        // starts — long before the row has actually been cleared. The tone
        // row going is the panel saying the value came back empty, which is
        // what the next press depends on.
        await page
          .getByRole("button", { name: "深", exact: true })
          .waitFor({ state: "detached", timeout: 30_000 })
          .catch(() => {});
      }
      await page.getByRole("button", { name: "底色" }).click();
      await preview.locator(".pic--tone").first().waitFor();
      // AND THE PANEL, NOT ONLY THE PAGE. The plate paints as soon as the row
      // is written; the tone row appears when the panel's own value catches
      // up, which is a beat later. Photographing on the first of the two
      // caught the panel mid-write and made a working feature look broken.
      await page.getByRole("button", { name: "深", exact: true }).waitFor();
    })(),
  );
  await shot(page, "03-editor-ground-applied");

  await watch(
    "a caption selection",
    (async () => {
      await preview.locator('[data-field="title"]').first().click();
      await page.getByRole("tab", { name: "Polish" }).waitFor();
    })(),
  );
  await shot(page, "04-editor-caption-selected");

  // ── The library, with photographs picked ─────────────────────────────────
  await page.goto(`${base}/photographs`);
  await watch(
    "pick two photographs",
    (async () => {
      const tiles = page.getByRole("main").locator("button[aria-pressed]");
      await tiles.first().click();
      await tiles.nth(1).click({ modifiers: ["Shift"] });
      await page.getByLabel("Assign to a lot").waitFor();
    })(),
  );
  await shot(page, "05-library-selected");

  await watch(
    "the assign picker open",
    (async () => {
      const search = page.getByLabel("Assign to a lot");
      await search.click();
      await search.fill("A8");
      await page.getByRole("button", { name: /A8/ }).first().waitFor();
    })(),
  );
  await shot(page, "06-library-assign-picker");

  // ── The rail, narrowed ───────────────────────────────────────────────────
  await page.goto(`${base}/events/${eventId}`);
  await watch(
    "the rail at icon width",
    (async () => {
      await page.getByRole("button", { name: /Icons only|Full width/ }).click();
      await page.waitForTimeout(200);
    })(),
  );
  await shot(page, "07-rail-icons");

  // PUT IT BACK. The width is a stored preference, so every screen this
  // harness photographs after the rail step inherited it — the two shots
  // below came out with a collapsed rail nobody had asked for, which is not
  // what a person opening the sale would see. A harness leaves the chrome as
  // it found it.
  await page
    .getByRole("button", { name: /Icons only|Full width/ })
    .click()
    .catch(() => {});

  // ── The sale's index, with a run of lots picked ──────────────────────────
  //
  // THE BAR HAS NO ADDRESS. It exists only while a hand is holding a
  // selection, so the static sweep can render this screen at ten widths and
  // never see it. Driven at the tablet as well as the desk, because packing a
  // crate is the gesture a registrar does standing up.
  for (const width of [1440, 768]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${base}/events/${eventId}`);
    const boxes = page.locator('tbody tr[data-lot] input[type="checkbox"]');
    await watch(
      `pick a run of lots at ${width}`,
      (async () => {
        await boxes.first().waitFor();
        await boxes.nth(1).click();
        await boxes.nth(5).click({ modifiers: ["Shift"] });
        await page.getByText("5 selected").waitFor();
      })(),
    );
    await shot(page, `${width === 1440 ? "08" : "09"}-lots-selected-${width}`);
  }
  await page.setViewportSize(WINDOW);

  await browser.close();

  console.log(`\n${shots.length} shots in ${out}`);
  if (failures.length > 0) {
    console.error(`\n${failures.length} gesture(s) did not land:`);
    for (const f of failures) console.error(`  ${f}`);
    process.exit(1);
  }
  console.log("every gesture landed");
}

main().catch((error) => {
  console.error("inspect-driven: failed —", error);
  process.exit(1);
});
