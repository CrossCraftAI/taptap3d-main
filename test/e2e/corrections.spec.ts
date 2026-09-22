// The correction loop, driven — and the one assertion the architecture rests on.
//
// DFD.md §4.2: "the correction returns to the engine as data and survives the
// next re-derivation." Every unit test in this repository could pass with that
// sentence false. So this makes three kinds of correction through the real
// screens — the record, this catalogue's overrides, a pin — then changes the
// density twice, and asserts each correction is still standing on a page it was
// never keyed to. Then it reverses every one of them, because a correction the
// person cannot undo is a defect (principle 9).
//
// Runs against the BUILT application and a real database, one worker.

import { expect, test, type FrameLocator, type Page } from "@playwright/test";
import pg from "pg";

import { createEvent } from "./sale";
import { shot } from "./shots";

const RUN = Date.now();
const EVENT = `Correction Sale ${RUN}`;
const REF = `C${RUN}`;
const ref = (n: number): string => `${REF}-${n}`;

// Six lots so that at 4-up the fourth and fifth straddle a page break, at 2-up
// they straddle a different one, and at 9-up they do not straddle at all.
const LOTS: [string, string, string][] = [
  ["青花梅瓶", "佚名", "80,000 – 120,000 HKD"],
  ["山水四屏", "張大千", "3,500,000 – 4,800,000 HKD"],
  ["白玉佩", "佚名", "18,000 – 26,000 HKD"],
  ["墨荷", "齊白石", "400,000 – 600,000 HKD"],
  ["秋山圖", "張大千", "800,000 – 1,200,000 HKD"],
  ["紫砂壺", "顧景舟", "200,000 – 300,000 HKD"],
];

const slotOf = (frame: FrameLocator, r: string) =>
  frame.locator(".slot").filter({ has: frame.locator(".ref", { hasText: r }) });

const pageOf = async (frame: FrameLocator, r: string): Promise<number> => {
  const page = frame.locator(".page").filter({ has: frame.locator(".ref", { hasText: r }) });
  return Number(await page.getAttribute("data-page"));
};

const panel = (page: Page) =>
  page.getByRole("complementary", { name: "Lots in this catalogue" });

test.describe.configure({ timeout: 180_000 });

test("a correction survives the density change it was never keyed to", async ({ page }) => {
  // ── A sale, through the ordinary path ────────────────────────────────────
  const { eventUrl } = await createEvent(page, EVENT);
  const eventId = eventUrl.split("/").pop()!;

  // From the blank editor's canvas, where quick-add lands.
  await page.getByRole("link", { name: "Import lots" }).first().click();
  await page
    .locator("textarea")
    .first()
    .fill(
      `編號\t品名\t作者\t估價\n` +
        LOTS.map(([t, m, p], i) => `${ref(i + 1)}\t${t}\t${m}\t${p}`).join("\n"),
    );
  await page.getByRole("button", { name: "Read this text" }).click();
  await page.getByRole("button", { name: /Import 6 lots/ }).click();
  await page.waitForURL(eventUrl);

  // ── The catalogue, derived: two pages at four-up ─────────────────────────
  await page.locator("main").getByRole("link", { name: "Catalogue" }).click();
  await expect(page.getByRole("heading", { name: "Catalogue" })).toBeVisible();
  const frame = page.frameLocator('iframe[title="Catalogue preview"]');
  await expect(frame.locator(".page")).toHaveCount(2);
  await expect(page.getByLabel("Per page")).toHaveValue("4");
  // The list beside the preview knows where each lot landed THIS time.
  await expect(panel(page).getByText("p.2").first()).toBeVisible();
  await page.screenshot({ path: shot("40-catalogue-before"), fullPage: true });

  // ── 1. THE RECORD: "that title is wrong" ─────────────────────────────────
  await panel(page).getByRole("link", { name: new RegExp(ref(2)) }).click();
  await page.waitForURL(/\/lots\//);
  const lotUrl = page.url();
  const lotId = lotUrl.split("/").pop()!;

  await expect(page.getByRole("heading", { name: new RegExp(`${ref(2)} · 山水四屏`) })).toBeVisible();
  await page.getByLabel("品名", { exact: true }).fill("山水四屏（修訂）");
  await page.getByRole("button", { name: "Save fields" }).click();
  await expect(page.getByRole("status").filter({ hasText: /^Saved/ })).toBeVisible();
  // The record changed: the header reads it back from the database.
  await expect(page.getByRole("heading", { name: /山水四屏（修訂）/ })).toBeVisible();
  await page.screenshot({ path: shot("41-lot-record-saved"), fullPage: true });

  // ── 1b. THE SALE IS A SEQUENCE ───────────────────────────────────────────
  // Correcting lots is per-lot work, and without a stepper each one costs
  // three gestures — back to the sale, find the row again in a table that has
  // scrolled, click it. On six lots that is an annoyance; on 128 it is two
  // extra days. So: forward and back land on the right lots, by pointer and
  // by key, and the ends are ends.
  await expect(page.getByText("Lot 2 of 6")).toBeVisible();

  await page.getByRole("link", { name: "Next lot" }).click();
  await expect(page.getByRole("heading", { name: new RegExp(ref(3)) })).toBeVisible();
  await expect(page.getByText("Lot 3 of 6")).toBeVisible();

  // The same step from the keyboard, with nothing focused — the listener is on
  // the window, which is the only way a shortcut is worth having.
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByRole("heading", { name: /山水四屏（修訂）/ })).toBeVisible();
  await expect(page.getByText("Lot 2 of 6")).toBeVisible();

  // ── AND NOT WHILE SOMEBODY IS TYPING ─────────────────────────────────────
  // The guard is one line — `isTyping(event.target)` in lot-steps.tsx — and
  // without this press, deleting it leaves the whole repository green: every
  // other press in this file happens with nothing focused, and test/keys.test.ts
  // exercises the predicate in isolation and never reaches the call site. What
  // it prevents is a specialist moving the caret inside a field and losing the
  // page they were part-way through filling in, with no dirty-state warning
  // anywhere to catch it. So it is asserted where it happens.
  const asPrice = page.getByLabel("Print 估價 as");
  await asPrice.fill("估價");
  await asPrice.press("ArrowLeft");
  await expect(page.getByText("Lot 2 of 6")).toBeVisible();
  await expect(asPrice).toBeFocused();
  await asPrice.fill("");

  // ── The ends do not wrap ─────────────────────────────────────────────────
  // Wrapping past lot 1 into lot 6 is the surprise that makes somebody lose
  // their place and re-edit twenty lots they had already done. There is no
  // link at the end, only a disabled button: asserting both is the point,
  // because an `aria-disabled` anchor would still navigate.
  await page.getByRole("link", { name: "Previous lot" }).click();
  await expect(page.getByRole("heading", { name: new RegExp(ref(1)) })).toBeVisible();
  await expect(page.getByText("Lot 1 of 6")).toBeVisible();
  await expect(page.getByRole("button", { name: "Previous lot" })).toBeDisabled();
  await expect(page.getByRole("link", { name: "Previous lot" })).toHaveCount(0);

  const firstUrl = page.url();
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByText("Lot 1 of 6")).toBeVisible();
  expect(page.url(), "the first lot must not wrap round to the last").toBe(firstUrl);

  // And the other end, reached the long way — which is also the gesture count
  // this control exists to remove.
  await page.getByRole("link", { name: EVENT }).click();
  await page.waitForURL(eventUrl);
  await page.getByRole("link", { name: ref(6), exact: true }).click();
  await expect(page.getByText("Lot 6 of 6")).toBeVisible();
  await expect(page.getByRole("button", { name: "Next lot" })).toBeDisabled();
  await expect(page.getByRole("link", { name: "Next lot" })).toHaveCount(0);
  await page.screenshot({ path: shot("41b-lot-steps-last"), fullPage: true });

  await page.keyboard.press("ArrowLeft");
  await expect(page.getByRole("heading", { name: new RegExp(ref(5)) })).toBeVisible();
  await expect(page.getByText("Lot 5 of 6")).toBeVisible();

  // Back to the lot being corrected; the rest of this test is about it.
  await page.goto(lotUrl);
  await expect(page.getByRole("heading", { name: /山水四屏（修訂）/ })).toBeVisible();

  // ── 2. THIS CATALOGUE: leave the maker off, print the estimate differently ─
  await expect(page.getByText("nothing overridden")).toBeVisible();
  await page.getByLabel("Hide 作者 in this catalogue").check();
  await page.getByLabel("Print 估價 as").fill("估價待詢");
  await page.getByRole("button", { name: "Apply to this catalogue" }).click();
  await expect(page.getByRole("status").filter({ hasText: /Applied to this catalogue/ })).toBeVisible();
  await expect(page.getByText("2 fields overridden", { exact: true })).toBeVisible();
  // Said in the header too, so it is known before the section is scrolled to.
  await expect(page.getByText(/2 fields overridden in the catalogue/)).toBeVisible();
  // The screen SAYS which values are not the record's (principle 9).
  await expect(page.getByText("overridden", { exact: true })).toHaveCount(2);
  await expect(page.getByText("hidden", { exact: true })).toBeVisible();
  // And the record column still shows the record: nothing was written into it.
  await expect(page.getByRole("cell", { name: "張大千" })).toBeVisible();
  await page.screenshot({ path: shot("42-lot-catalogue-overrides"), fullPage: true });

  // ── The preview at four-up carries all three ─────────────────────────────
  await page.getByRole("link", { name: "Open catalogue" }).click();
  await expect(page.getByRole("heading", { name: "Catalogue" })).toBeVisible();
  await expect(frame.locator(".page")).toHaveCount(2);

  const corrected = slotOf(frame, ref(2));
  await expect(corrected.locator(".line--title")).toContainText("山水四屏（修訂）");
  await expect(corrected.locator(".line--maker")).toHaveCount(0);
  await expect(corrected.locator(".line--price")).toContainText("估價待詢");
  // THE CONTROL: the lot beside it still prints its maker, so the hiding was
  // this lot's and not the catalogue's.
  await expect(slotOf(frame, ref(1)).locator(".line--maker")).toContainText("佚名");
  await expect(panel(page).getByText("2 overridden")).toBeVisible();
  await expect(page.getByText(/· 2 overrides/)).toBeVisible();

  // ── 3. A PIN: the fourth and fifth lot, which four-up splits ─────────────
  expect(await pageOf(frame, ref(4))).toBe(1);
  expect(await pageOf(frame, ref(5))).toBe(2);
  await panel(page).getByLabel(`Select ${ref(4)}`).check();
  await panel(page).getByLabel(`Select ${ref(5)}`).check();
  await expect(panel(page).getByText("2 selected")).toBeVisible();
  await panel(page).getByRole("button", { name: "Pin together" }).click();

  await expect(panel(page).getByText(`${ref(4)} · ${ref(5)}`)).toBeVisible();
  await expect(panel(page).getByRole("button", { name: "Unpin" })).toBeVisible();
  await expect(frame.locator(".page")).toHaveCount(2);
  expect(await pageOf(frame, ref(4))).toBe(await pageOf(frame, ref(5)));
  // The gap is left, not back-filled: page one has three lots.
  await expect(frame.locator(".page").first().locator(".slot")).toHaveCount(3);
  await page.screenshot({ path: shot("43-catalogue-corrected-4up"), fullPage: true });

  // ── A pin the engine could not honour is refused, in words ───────────────
  await panel(page).getByLabel(`Select ${ref(1)}`).check();
  await panel(page).getByLabel(`Select ${ref(3)}`).check();
  await panel(page).getByRole("button", { name: "Pin together" }).click();
  await expect(panel(page).getByText(/must be neighbours/)).toBeVisible();
  await panel(page).getByLabel(`Select ${ref(3)}`).uncheck();
  await panel(page).getByLabel(`Select ${ref(1)}`).uncheck();

  // ── THE THESIS. Change the density; everything above must still stand ────
  await page.getByLabel("Per page").selectOption("9");
  await expect(frame.locator(".page")).toHaveCount(1);
  await expect(slotOf(frame, ref(2)).locator(".line--title")).toContainText("山水四屏（修訂）");
  await expect(slotOf(frame, ref(2)).locator(".line--maker")).toHaveCount(0);
  await expect(slotOf(frame, ref(2)).locator(".line--price")).toContainText("估價待詢");
  await expect(slotOf(frame, ref(1)).locator(".line--maker")).toContainText("佚名");
  await page.screenshot({ path: shot("44-catalogue-corrected-9up"), fullPage: true });

  await page.getByLabel("Per page").selectOption("2");
  // Two-up would put lots 3–4 on page two and 5–6 on page three, splitting the
  // pin a different way from four-up. The pin holds, so it becomes four pages:
  // 1–2 · 3 · 4–5 · 6. Nothing about the pin said "page two" or "page three".
  await expect(frame.locator(".page")).toHaveCount(4);
  expect(await pageOf(frame, ref(4))).toBe(await pageOf(frame, ref(5)));
  expect(await pageOf(frame, ref(4))).toBe(3);
  await expect(slotOf(frame, ref(2)).locator(".line--title")).toContainText("山水四屏（修訂）");
  await expect(slotOf(frame, ref(2)).locator(".line--maker")).toHaveCount(0);
  await expect(slotOf(frame, ref(2)).locator(".line--price")).toContainText("估價待詢");
  await expect(panel(page).getByText(`${ref(4)} · ${ref(5)}`)).toBeVisible();
  await expect(page.getByLabel("Per page")).toHaveValue("2");
  await page.screenshot({ path: shot("45-catalogue-corrected-2up"), fullPage: true });

  // ── REVERSIBLE: every correction comes off, and the defaults return ──────
  await panel(page).getByRole("button", { name: "Unpin" }).click();
  await expect(panel(page).getByText(`${ref(4)} · ${ref(5)}`)).toHaveCount(0);
  await expect(frame.locator(".page")).toHaveCount(3);

  await page.goto(lotUrl);
  await page.getByLabel("Hide 作者 in this catalogue").uncheck();
  await page.getByLabel("Print 估價 as").fill("");
  await page.getByRole("button", { name: "Apply to this catalogue" }).click();
  await expect(page.getByRole("status").filter({ hasText: /Applied to this catalogue/ })).toBeVisible();
  await expect(page.getByText("nothing overridden")).toBeVisible();

  await page.getByRole("link", { name: "Open catalogue" }).click();
  await expect(slotOf(frame, ref(2)).locator(".line--maker")).toContainText("張大千");
  await expect(slotOf(frame, ref(2)).locator(".line--price")).toContainText("3,500,000");
  // The record edit stays, because it was an edit to the record.
  await expect(slotOf(frame, ref(2)).locator(".line--title")).toContainText("山水四屏（修訂）");
  await page.screenshot({ path: shot("46-catalogue-reversed"), fullPage: true });

  // ── THE INSTRUMENT counted every one of those gestures ───────────────────
  // Read from the database, because there is deliberately no endpoint that
  // lists the log — it is an instrument, not a feature.
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    // The stepper carries no catalogue and no lotId — it is a gesture about
    // the SALE — so the event in its own payload is the third way in.
    // Cast, because $1 is a uuid everywhere else in this predicate and
    // `->>` hands back text.
    const COUNTS = `select a.action, count(*)::text as n
         from action_log a
         left join catalogues c on c.id = a.catalogue_id
        where (c.event_id = $1
               or a.payload->>'lotId' = $2
               or a.payload->>'eventId' = $1::text)
        group by a.action order by a.action`;
    const readCounts = async (): Promise<Record<string, number>> => {
      const { rows } = await pool.query<{ action: string; n: string }>(COUNTS, [eventId, lotId]);
      return Object.fromEntries(rows.map((r) => [r.action, Number(r.n)]));
    };

    // EXACTLY FOUR STEPS, two by pointer and two by key — and the exactness is
    // the assertion. A fifth means one of the two refusals stepped anyway: the
    // press at the first lot, or the press inside a field. A fourth missing
    // means a step stopped being counted. `>= 3` tolerated the second of those
    // silently, which is the failure this instrument exists to notice at all
    // (principle 5).
    //
    // Polled, because logAction is fire and forget by design
    // (src/lib/log/client.ts) and the last press can still be in flight.
    await expect.poll(async () => (await readCounts())["lot.step"] ?? 0).toBe(4);

    const counts = await readCounts();
    expect(counts["lot.fields.save"]).toBeGreaterThanOrEqual(1);
    expect(counts["catalogue.override.save"]).toBeGreaterThanOrEqual(2);
    expect(counts["catalogue.pin"]).toBeGreaterThanOrEqual(2); // one made, one refused
    expect(counts["catalogue.unpin"]).toBeGreaterThanOrEqual(1);
    expect(counts["catalogue.params"]).toBeGreaterThanOrEqual(2);

    // And a human decision was written as a HUMAN decision — by the gate
    // identity, never as null — while the record itself has no override.
    const decided = await pool.query<{ decided: string | null; email: string | null }>(
      `select o.decided_by as decided, u.email
         from overrides o left join users u on u.id = o.decided_by
         join catalogues c on c.id = o.catalogue_id
        where c.event_id = $1`,
      [eventId],
    );
    // Everything was reversed, so nothing is left — the reversal was a delete,
    // not a row that says "undone".
    expect(decided.rows).toHaveLength(0);
  } finally {
    await pool.end();
  }
});
