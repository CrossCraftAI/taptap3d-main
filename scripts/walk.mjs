// Walk the product the way a person does, and report on the way back.
//
// ── WHAT IT ASKS AT EVERY SCREEN ───────────────────────────────────────────
//
//   IS THERE A WAY UP that is not the rail? The rail can be put away (Ctrl+\),
//   and a screen whose only exit is a control the reader has hidden is a dead
//   end. So this looks for a link inside `main` that points at an ancestor of
//   the current path — a breadcrumb, a parent's name, a "back to the sale".
//
//   DOES THE RAIL MARK WHERE YOU ARE, and mark it once? test/nav.test.ts pins
//   that rule over the pure function; this checks the rendered document, where
//   a filter tab can also claim `aria-current` and a reader then has two
//   answers to "which page am I on".
//
// A REPORT, NOT A TEST. The suite holds the rules that must not change; this
// is for asking the question again after a screen is added, which is when a
// dead end appears. Nothing here fails a build.
//
//   node scripts/walk.mjs http://127.0.0.1:3200 <event id>

import { chromium } from "playwright";

const base = process.argv[2] ?? "http://127.0.0.1:3200";
const ev = process.argv[3];
const notes = [];
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
p.setDefaultTimeout(30000);

const lot = await (async () => {
  await p.goto(`${base}/events/${ev}`);
  const href = await p.locator('tbody tr[data-lot] a[href*="/lots/"]').first().getAttribute("href");
  return href.split("/").pop();
})();

const screens = [
  ["ledger", `/`],
  ["sale", `/events/${ev}`],
  ["editor", `/events/${ev}/catalogue`],
  ["import", `/events/${ev}/import`],
  ["condition register", `/events/${ev}/condition`],
  ["movement register", `/events/${ev}/movement`],
  ["lot record", `/events/${ev}/lots/${lot}`],
  ["lot condition", `/events/${ev}/lots/${lot}/condition`],
  ["lot movement", `/events/${ev}/lots/${lot}/movement`],
  ["photographs", `/photographs`],
  ["settings", `/settings`],
];

for (const [name, href] of screens) {
  await p.goto(base + href);
  // 1. Is there a link UP — to the parent screen — that is not the rail?
  const inMain = p.getByRole("main").getByRole("link");
  const ups = await inMain.evaluateAll((els, here) => {
    const parent = here.split("/").slice(0, -1).join("/") || "/";
    return els
      .map((e) => new URL(e.href).pathname)
      .filter((h) => h !== here && here.startsWith(h));
  }, href);
  // 2. Does the rail mark exactly one place?
  const marked = await p.locator('[aria-current="page"]').count();
  // 3. What does the rail say is current?
  const current = (await p.locator('[aria-current="page"]').first().textContent().catch(() => ""))?.trim().slice(0, 30);
  notes.push({ screen: name, wayUp: [...new Set(ups)].join(" ") || "NONE", marked, current });
}

console.table(notes);
await b.close();
