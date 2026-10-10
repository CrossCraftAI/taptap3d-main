import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { expect, test } from "@playwright/test";
import { getDb, getPool, orgs, events, lots, users } from "../../src/db";
let eventId: string, lotId: string;
test.beforeAll(async () => {
  const db = getDb();
  const [org] = await db.select().from(orgs).where(eq(orgs.slug, process.env.TAPTAP3D_ORG_SLUG ?? "dev"));
  if (!org) throw new Error("Seed the development organisation first.");
  const [event] = await db.insert(events).values({ orgId: org.id, name: `Publication browser ${randomUUID()}` }).returning();
  eventId = event!.id;
  const [lot] = await db.insert(lots).values({ orgId: org.id, eventId, position: 0, ref: "PUB1", fields: { title: "Public vessel", description: "Approved description", reserve: "NEVER AUTO SELECT" } }).returning();
  lotId = lot!.id;
});
test.afterAll(async () => { if (eventId) await getDb().delete(events).where(eq(events.id, eventId)); await getPool().end(); });
test("approve, read without a login, embed on mobile, and withdraw every public URL", async ({ page, request }, testInfo) => {
  await page.goto(`/events/${eventId}/lots/${lotId}/publish`);
  await expect(page.getByRole("heading", { name: "Publish listing · PUB1" })).toBeVisible();
  await page.locator('input[name="fields"][value="title"]').check();
  await page.locator('input[name="fields"][value="description"]').check();
  await page.locator('select[name="titleField"]').selectOption("title");
  await page.locator('input[name="descriptionFields"][value="description"]').check();
  await page.locator('select[name="language"]').selectOption("en");
  await page.getByLabel("I reviewed these fields").check();
  await page.screenshot({ path: testInfo.outputPath("publication-review.png"), fullPage: true });
  await page.getByRole("button", { name: "Approve public revision" }).click();
  await expect(page.getByRole("status")).toContainText("Approved rev_");
  const jsonUrl = await page.getByLabel("JSON URL", { exact: true }).inputValue();
  const listingUrl = await page.getByLabel("Listing URL", { exact: true }).inputValue();
  const json = await request.get(jsonUrl);
  expect(json.status()).toBe(200); expect(json.headers()["cache-control"]).toBe("no-store");
  const listing = await json.json();
  expect(listing.title).toBe("Public vessel"); expect(JSON.stringify(listing)).not.toContain("NEVER AUTO SELECT");
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto(listingUrl.replace("/p/", "/embed/"));
  await expect(page.getByRole("heading", { name: "Public vessel" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("publication-mobile.png") });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const frameUrl = listingUrl.replace("/p/", "/embed/");
  await page.route("**/__publication-host", route => route.fulfill({ contentType: "text/html", body: `<!doctype html><html><body><script>window.messages=[];addEventListener('message',event=>{if(event.origin===location.origin && event.source===document.querySelector('iframe').contentWindow)window.messages.push(event.data);});</script><iframe title="Listing" src="${frameUrl}"></iframe></body></html>` }));
  await page.goto("/__publication-host");
  await expect(page.frameLocator('iframe').getByRole("heading", { name: "Public vessel" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as unknown as { messages: { type: string; version: number; publicationId: string }[] }).messages.some(message => message.type === "taptap3d:ready" && message.version === 1 && message.publicationId.startsWith("pub_")))).toBe(true);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/events/${eventId}/lots/${lotId}/publish`);
  await page.getByLabel("Withdraw this publication").check();
  await page.getByRole("button", { name: "Withdraw publication" }).click();
  await expect(page.getByRole("heading", { name: "Previous publication withdrawn" })).toBeVisible();
  expect((await request.get(`${jsonUrl}?revision=${listing.revision}`)).status()).toBe(410);
  expect((await request.get(listingUrl)).status()).toBe(410);
});

test("an owner grants a colleague access, changes the role and removes access", async ({ page }) => {
  const email = `browser-team-${randomUUID()}@example.com`;
  try {
    await page.goto("/settings/team");
    await page.getByLabel("Google account email").fill(email);
    await page.getByRole("button", { name: "Grant access", exact: true }).click();
    const member = page.locator("section").filter({ has: page.getByRole("heading", { name: email, exact: true }) });
    await expect(member).toContainText("Awaiting first sign-in");
    await member.locator('select[name="role"]').selectOption("admin");
    await member.getByRole("button", { name: "Update access" }).click();
    await expect(member.getByRole("status")).toContainText("Membership updated.");
    await member.locator('select[name="role"]').selectOption("remove");
    await member.getByRole("button", { name: "Update access" }).click();
    await expect(page.getByRole("heading", { name: email, exact: true })).toHaveCount(0);
  } finally { await getDb().delete(users).where(eq(users.email, email)); }
});
