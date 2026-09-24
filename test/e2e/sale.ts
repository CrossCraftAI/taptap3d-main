// Quick-add a sale, the way the demo opens, and land where quick-add lands.
//
// M1.md §1 step 2: create an event → an empty editor. Quick-add now opens the
// catalogue — a blank page with the controls live — and every driven spec that
// makes a sale starts there. The import lands back on the EVENT, one segment
// up, so both URLs are returned: the specs wait on the event after importing
// and open the editor from it, as a person does.

import { expect, type Page } from "@playwright/test";

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
