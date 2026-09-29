// Quick-add a sale, the way the demo opens, and land where quick-add lands.
//
// M1.md §1 step 2: create an event → an empty editor. Quick-add now opens the
// catalogue — a blank page with the controls live — and every driven spec that
// makes a sale starts there. The import lands back on the EVENT, one segment
// up, so both URLs are returned: the specs wait on the event after importing
// and open the editor from it, as a person does.

import { expect, type Locator, type Page } from "@playwright/test";

export async function createEvent(
  page: Page,
  name: string,
): Promise<{ eventUrl: string; editorUrl: string }> {
  await page.goto("/");
  await page.getByLabel("Event name").fill(name);
  await page.getByRole("button", { name: "Create event" }).click();
  await page.waitForURL(/\/events\/[0-9a-f-]+\/catalogue$/);
  // The editor names the sale in its toolbar, as the way back to it.
  await expect(page.getByRole("link", { name })).toBeVisible();
  const editorUrl = page.url();
  return { eventUrl: editorUrl.replace(/\/catalogue$/, ""), editorUrl };
}

/**
 * Paste a list into the import screen and press Read, once the page is
 * listening.
 *
 * ── THE HYDRATION RACE, AND WHY THIS IS NOT A SLEEP ─────────────────────────
 *
 * The textarea is a controlled React input and "Read this text" is disabled
 * while it is empty. `fill()` sets the DOM value and fires an input event — but
 * if it lands before the bundle has hydrated, nobody is listening: hydration
 * then reconciles the textarea back to its state, which is the empty string,
 * and the button is disabled for ever. The test does not fail fast; it waits
 * the whole test timeout for a control that can no longer change.
 *
 * Measured rather than guessed. Two specs failed this way on WebKit in a
 * whole-column run and passed alone, with code identical to three specs that
 * pass — which is the signature of a race rather than of a difference. The
 * others are not immune; they are winning it.
 *
 * `toPass` retries the fill itself, so the first attempt that lands after
 * hydration sticks. Rejected: waiting a fixed time before filling, which is the
 * same bet with worse odds on a slower machine; and pressing a key to nudge
 * React, which enables the button without putting the text back.
 */
export async function pasteAndRead(page: Page, text: string): Promise<void> {
  const box = page.locator("textarea").first();
  const read = page.getByRole("button", { name: "Read this text" });
  await expect(async () => {
    // CLEARED FIRST, and that is what makes the retry a retry. React tracks
    // the last value it set on a controlled input; filling the SAME string
    // again is not a change, so no input event fires and every attempt after
    // the first is a no-op. Measured: thirty seconds of retries against a
    // button that stayed disabled the whole time, because only the first fill
    // was ever a real one. Clearing makes each attempt a genuine change.
    await box.fill("");
    await box.fill(text);
    await expect(read).toBeEnabled({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  await read.click();
}

/**
 * Choose a template, whichever shape the control is in.
 *
 * ── TWO SHAPES, AND THAT IS THE PRODUCT, NOT THE TEST ──────────────────────
 *
 * On a sale with lots the picker is a row of page proxies the engine drew —
 * radios behind them, `name="template"`, one per template. On a sale with no
 * lots there are no proxies to draw, so it falls back to the `<select>` it
 * always was. A spec should not have to know which it met, and nine call
 * sites across three files should not each work it out.
 *
 * Written when the tiles landed: `getByLabel("Template").selectOption(id)`
 * was in nine places and failed in all of them at once, which is the shape of
 * a helper that should have existed before the change.
 */
export async function chooseTemplate(page: Page, id: string): Promise<void> {
  const radio = page.locator(`input[name="template"][value="${id}"]`);
  if ((await radio.count()) > 0) {
    // THE LABEL, NOT THE INPUT, because the input is `sr-only` — a 1px box at
    // zero opacity under the tile. `check()` on it never settles: Playwright
    // waits for the element itself to receive the pointer, and the tile is
    // what is actually on top. Four specs sat at the 240s timeout before this
    // was written down.
    //
    // Clicking the label IS the gesture a person makes, and the browser's own
    // label-for-input behaviour ticks the radio — so this is also the more
    // honest thing to drive.
    await page.locator(`label:has(input[name="template"][value="${id}"])`).click();
    await expect(radio).toBeChecked();
    return;
  }
  await page.getByLabel("Template").selectOption(id);
}

/** Which template the control says is current, in either shape. */
export async function templateIs(page: Page, id: string): Promise<void> {
  const radio = page.locator(`input[name="template"][value="${id}"]`);
  if ((await radio.count()) > 0) {
    await expect(radio).toBeChecked();
    return;
  }
  await expect(page.getByLabel("Template")).toHaveValue(id);
}

/**
 * The template control, whichever shape it is in.
 *
 * For the assertions that are about the control itself rather than about
 * choosing with it — "is it live on a blank sale". The blank sale is the one
 * screen that meets the `<select>`, so a spec that hard-codes the radio passes
 * everywhere except the case it was written for.
 */
export function templateControl(page: Page): Locator {
  return page.locator('input[name="template"], select[name="template"]').first();
}
