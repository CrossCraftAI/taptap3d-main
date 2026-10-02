// The running order — the editorial work of an auction, driven.
//
// ── WHY THIS CANNOT BE A UNIT TEST ─────────────────────────────────────────
//
// The pure half is `src/lib/lot-order.ts`, exhaustively tested in node: which
// lots move together, and the property that no move can break a pin. All of
// it would pass with this feature wired to nothing.
//
// What only a browser can say is that the seam holds: that a gesture in the
// table reaches an action, that the action resolves it against the WHOLE sale
// rather than the fifty rows on screen, that the renumbering lands in
// Postgres, and — the one that matters most — that the document the printer
// gets follows. A reorder that changed the list and not the pages would be
// the worst possible version of this.
//
// THE KEYBOARD IS THE PATH DRIVEN, and that is not a compromise. It is the
// same gesture through the same action as the drag (src/lib/lot-order.ts says
// why there is one mover), and it is the half a specialist with a trackpad
// injury has. A pointer drag is asserted once, separately, because native
// drag-and-drop is the flakiest thing a browser does.

import { expect, test, type Page } from "@playwright/test";

import { createEvent } from "./sale";
import { shot } from "./shots";

const RUN = Date.now();
const REF = `OR${RUN}`;
const ref = (n: number): string => `${REF}-${n}`;

test.use({ viewport: { width: 1440, height: 900 } });
test.describe.configure({ timeout: 180_000 });

/**
 * The sale's refs, in the order the index draws them.
 *
 * READ OFF `data-ref`, NOT OUT OF A CELL. The first version of this walked to
 * the second `<td>` and broke the moment the grip column arrived — which it
 * did, in the same commit. The table already carries `data-page` for exactly
 * this reason; this is the second of them.
 */
async function order(page: Page): Promise<string[]> {
  return page.$$eval("tbody tr[data-lot]", (rows) =>
    rows.map((row) => row.getAttribute("data-ref") ?? ""),
  );
}

/** Move the lot with this ref one step, from the keyboard. */
async function step(page: Page, lotRef: string, key: "ArrowUp" | "ArrowDown"): Promise<void> {
  const before = (await order(page)).join(",");
  await page.getByRole("button", { name: new RegExp(`Move ${lotRef} `) }).focus();
  await page.keyboard.press(key);
  // THE SERVER DECIDES, SO WAIT FOR IT. The action revalidates and the table
  // re-renders; asserting immediately reads the list as it was.
  await expect
    .poll(async () => (await order(page)).join(","), { timeout: 30_000 })
    .not.toBe(before);
}

async function importLots(page: Page, eventUrl: string, count: number): Promise<void> {
  await page.goto(`${eventUrl}/import`);
  await page
    .locator("textarea")
    .first()
    .fill(
      `編號\t品名\t作者\t估價\n` +
        Array.from({ length: count }, (_, i) =>
          [ref(i + 1), `拍品 ${i + 1}`, "佚名", "80,000 – 120,000 HKD"].join("\t"),
        ).join("\n"),
    );
  await page.getByRole("button", { name: "Read this text" }).click();
  await page.getByRole("button", { name: new RegExp(`Import ${count} lots`) }).click();
  await page.waitForURL(eventUrl);
}

test("a sale can be re-sequenced, and the catalogue follows", async ({ page }) => {
  const { eventUrl, editorUrl } = await createEvent(page, `Order Sale ${RUN}`);
  await importLots(page, eventUrl, 6);

  // THE ORDER THE CLIENT'S FILE HAD. Until this feature existed it was the
  // only order a sale could ever be in.
  expect(await order(page)).toEqual([1, 2, 3, 4, 5, 6].map(ref));

  // ── THE CLOSING LOT IS ACTUALLY THE OPENER ───────────────────────────────
  // Five steps up, because that is what a person does, and because a single
  // step would not distinguish "moves" from "moves correctly".
  for (let i = 0; i < 5; i++) await step(page, ref(6), "ArrowUp");
  expect(await order(page)).toEqual([6, 1, 2, 3, 4, 5].map(ref));
  await page.screenshot({ path: shot("70-order-resequenced"), fullPage: true });

  // It does not wrap: at the top, up is nothing. Asserted by pressing and
  // seeing the list unchanged, rather than by the absence of a control.
  await page.getByRole("button", { name: new RegExp(`Move ${ref(6)} `) }).focus();
  await page.keyboard.press("ArrowUp");
  await page.waitForTimeout(500);
  expect(await order(page)).toEqual([6, 1, 2, 3, 4, 5].map(ref));

  // ── AND IT SURVIVES A RELOAD, which is what makes it a decision rather
  //    than a rearrangement of the screen.
  await page.reload();
  expect(await order(page)).toEqual([6, 1, 2, 3, 4, 5].map(ref));

  // ── THE DOCUMENT FOLLOWS ─────────────────────────────────────────────────
  // The seam a per-screen test structurally cannot reach: the order is the
  // document, so the editor's first page must now open with the lot that was
  // last. `previewKey` folds max(lots.updatedAt), so the frame reloads
  // without the table knowing how.
  await page.goto(editorUrl);
  const preview = page.frameLocator('iframe[title="Catalogue preview"]');
  await expect(preview.locator(".page").first()).toBeVisible();
  await expect
    .poll(
      async () =>
        preview
          .locator(".slot, .entry, [data-lot]")
          .first()
          .innerText()
          .catch(() => ""),
      { timeout: 30_000 },
    )
    .toContain(ref(6));
  await page.screenshot({ path: shot("71-order-in-the-document"), fullPage: true });
});

test("a pin moves as one block, so it cannot be split", async ({ page }) => {
  // ── THE TRAP THIS FEATURE HAD TO BE BUILT AROUND ─────────────────────────
  //
  // The engine keeps pinned lots together by merging a lot into the current
  // run only when the lot IMMEDIATELY BEFORE it carries the same pin, and
  // `createPin` checks adjacency once, at creation — which was sufficient
  // only while the order was immutable. Pin two lots, drag a third between
  // them, and the pin silently stops doing anything: nothing is cut, nothing
  // is marked, and the specialist finds out at the printer.
  const { eventUrl, editorUrl } = await createEvent(page, `Pin Order ${RUN}`);
  await importLots(page, eventUrl, 6);

  // Pin lots 2 and 3 together, through the editor's own panel.
  await page.goto(editorUrl);
  const panel = page.getByRole("complementary", { name: "Lots in this catalogue" });
  await panel.getByLabel(`Select ${ref(2)}`).check();
  await panel.getByLabel(`Select ${ref(3)}`).check();
  await panel.getByRole("button", { name: "Pin together" }).click();
  await expect(panel.getByRole("button", { name: "Unpin" })).toBeVisible();

  // Now try to put lot 5 between them, from the index.
  await page.goto(eventUrl);
  expect(await order(page)).toEqual([1, 2, 3, 4, 5, 6].map(ref));

  // Stepping lot 5 up twice would land it between 2 and 3 if a pin were two
  // separate places. It is one block, so 5 steps OVER the pair.
  await step(page, ref(5), "ArrowUp");
  expect(await order(page)).toEqual([1, 2, 3, 5, 4, 6].map(ref));
  await step(page, ref(5), "ArrowUp");
  const after = await order(page);
  expect(after).toEqual([1, 5, 2, 3, 4, 6].map(ref));

  // THE ASSERTION THE WHOLE DESIGN EXISTS FOR: 2 and 3 are still neighbours,
  // whatever route anything took to get here.
  expect(after.indexOf(ref(3))).toBe(after.indexOf(ref(2)) + 1);
  await page.screenshot({ path: shot("72-order-pin-intact"), fullPage: true });

  // And moving a MEMBER moves the pair, rather than tearing one out of it.
  // ONE STEP IS ONE BLOCK, so from 1·5·[2 3]·4·6 the pair goes before 5 —
  // not before 1. The first version of this assertion expected it to jump
  // two places, which was arithmetic rather than a defect.
  await step(page, ref(2), "ArrowUp");
  const moved = await order(page);
  expect(moved).toEqual([1, 2, 3, 5, 4, 6].map(ref));
  expect(moved.indexOf(ref(3))).toBe(moved.indexOf(ref(2)) + 1);
});

test("the grip drags, and an ordinary click on a row still opens it", async ({
  page,
  browserName,
}) => {
  const { eventUrl } = await createEvent(page, `Drag Order ${RUN}`);
  await importLots(page, eventUrl, 4);

  // THE CLICK THAT MUST NOT BECOME A DRAG. The grip is the only thing that
  // starts one; the title is a link and stays a link, which is the whole
  // reason the handle is its own control rather than the row being draggable.
  await page.getByRole("link", { name: ref(2), exact: true }).click();
  await page.waitForURL(/\/lots\/[0-9a-f-]+$/);
  await page.goBack();
  await expect(page.locator("tbody tr[data-lot]").first()).toBeVisible();

  // Native drag-and-drop is the flakiest thing a browser does, and webkit's
  // implementation of it under automation is the flakiest of those. The
  // POINTER path is asserted on chromium; both engines prove the gesture
  // through the keyboard above, which reaches the same action.
  test.skip(browserName === "webkit", "native DnD under webkit automation");

  await page
    .locator(`[data-grip]`)
    .nth(3)
    .dragTo(page.locator("tbody tr[data-lot]").first());
  await expect
    .poll(async () => (await order(page)).join(","), { timeout: 30_000 })
    .toBe([4, 1, 2, 3].map(ref).join(","));
});
