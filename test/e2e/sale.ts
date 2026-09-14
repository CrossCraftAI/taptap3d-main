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
