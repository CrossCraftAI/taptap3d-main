#!/usr/bin/env node
/**
 * Generic UI inspection harness.
 *
 * Renders routes across viewports, captures a PNG of each, and reports the defects that can be
 * measured — so that your eyes are free for the ones that cannot (see SKILL.md step 3).
 *
 * What it checks, and why each one earns its place:
 *
 *   FAIL  uncaught exception          a route that throws renders an error boundary, and every
 *                                     other assertion then passes against an empty page
 *   FAIL  console error               the same class of defect, one step quieter
 *   FAIL  horizontal document scroll  the user can physically drag the page sideways
 *   WARN  element past the right edge  usually real, sometimes a carousel — see the clipping
 *                                     -ancestor rule below
 *   WARN  no links on the page         the signature of a route that died on load
 *
 * Severity is split deliberately: FAIL means a user would certainly hit it, WARN means look.
 *
 * Usage
 *   node inspect.mjs --base http://localhost:5173 --routes / /watch /account --out ./shots
 *   node inspect.mjs --config ui-inspect.json
 *   node inspect.mjs --help
 *
 * Playwright resolves from the working directory, so run this from the repo that has it:
 *   npm i -D playwright && npx playwright install chromium
 */

import { mkdir, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";

/*
 * 320 IS IN HERE FOR A REASON, and so is the landscape phone.
 *
 * A real 27px document overflow on a live site reproduced only at or below 347px — the usual
 * 390 starting width was just wide enough to swallow it. Small Androids and the older SE are
 * still 320. Landscape earns its place separately: a 16:9 player computes taller than a 390px
 * viewport, which no portrait size can reveal, and landscape is how people watch video.
 *
 * The 1024-1199 band is here because a layout can reserve an expanded sidebar's width while
 * the sidebar is collapsed; on one real site that left a 320px dead gutter across exactly
 * that band and nowhere else.
 */
const DEFAULT_VIEWPORTS = [
  { name: "phone-sm", width: 320, height: 568 },
  { name: "phone", width: 390, height: 844 },
  { name: "phone-lg", width: 430, height: 932 },
  { name: "phone-ls", width: 844, height: 390 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "tablet-ls", width: 1024, height: 768 },
  { name: "laptop-sm", width: 1152, height: 800 },
  { name: "laptop", width: 1280, height: 800 },
  { name: "desktop", width: 1440, height: 900 },
  { name: "wide", width: 1920, height: 1080 },
];

function parseArgs(argv) {
  const out = { routes: [], viewports: null, storage: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--base") out.base = next();
    else if (a === "--out") out.out = next();
    else if (a === "--config") out.config = next();
    else if (a === "--init") out.init = next();
    else if (a === "--timeout") out.timeout = Number(next());
    else if (a === "--full-page") out.fullPage = true;
    else if (a === "--json") out.json = next();
    else if (a === "--viewports") {
      // "390x844,1440x900" — an explicit subset, for a quick re-check of one breakpoint
      out.viewports = next()
        .split(",")
        .map((s) => {
          const [w, h] = s.trim().split("x").map(Number);
          return { name: `${w}x${h}`, width: w, height: h };
        });
    } else if (a === "--routes") {
      while (argv[i + 1] && !argv[i + 1].startsWith("--")) out.routes.push(argv[++i]);
    } else if (a === "--basic") {
      /*
       * `--basic user:password`, or `--basic user` with the password on stdin.
       *
       * A STAGING DEPLOYMENT IS USUALLY BEHIND A GATE, and the deployed half of
       * this loop is the half that has real data in it. Without this the sweep
       * can only reach a 401 page, which renders clean at every width and says
       * nothing — the worst kind of green.
       *
       * It goes to `httpCredentials` on the context, so every request in the
       * run carries it, including the ones a page makes for itself. Not into
       * the URL: Chromium strips embedded credentials from subresource
       * requests, so images and API calls come back 401 while the document
       * looks fine.
       */
      const [user, ...rest] = next().split(":");
      out.basic = { username: user, password: rest.join(":") };
    } else if (a === "--storage") {
      // --storage key=value, repeatable: seed localStorage before the app boots
      const [k, ...rest] = next().split("=");
      out.storage[k] = rest.join("=");
    } else if (!a.startsWith("--") && !out.base) out.base = a;
  }
  return out;
}

const HELP = `
ui inspection harness

  --base <url>          origin to inspect, e.g. http://localhost:5173
  --routes <p> [p...]   paths to render (default: /)
  --out <dir>           where screenshots go (default: ./ui-inspect)
  --viewports <list>    override sizes, e.g. 390x844,1440x900 (default: 7 sizes, 390-1920)
  --basic user:pass     HTTP basic credentials, for a gated staging deployment
  --storage k=v         seed a localStorage key before boot; repeatable
                        (auth bypass, theme, dismissing a first-run gate)
  --init <file.js>      script injected before any page script — for anything --storage cannot do
  --config <file.json>  same options as a file: { base, routes, viewports, out, storage, waitFor }
  --full-page           capture the whole scroll height, not just the viewport
  --timeout <ms>        per-navigation timeout (default 20000)
  --json <file>         also write the findings as JSON

Exit code is 1 when anything FAILs, 0 otherwise. WARNs never fail the run — they are for you
to look at, and a WARN you decide is legitimate should be fixed at the rule, not muted here.
`;

const slug = (r) => (r === "/" ? "root" : r.replace(/^\/+|\/+$/g, "").replace(/[^\w.-]+/g, "-"));

/**
 * Undo the MSYS path rewrite.
 *
 * Git Bash mangles any argument that looks like a unix absolute path before node is even
 * started: `--routes /watch` arrives as `C:/Program Files/Git/watch`, and the run then reports
 * a wall of connection failures against nonsense URLs. Quoting does not reliably stop it.
 *
 * A route can never legitimately be a Windows absolute path, so recovering it is unambiguous —
 * and much kinder than expecting everyone to remember MSYS_NO_PATHCONV=1.
 */
const MSYS_PREFIX = /^[A-Za-z]:[\\/].*?(?:Git|msys64|mingw64|usr)[\\/]/i;
function unmangleRoute(r) {
  if (!/^[A-Za-z]:[\\/]/.test(r)) return r;
  const m = r.match(MSYS_PREFIX);
  if (!m) return r;
  return "/" + r.slice(m[0].length).replace(/\\/g, "/").replace(/^\/+/, "");
}

/**
 * Find playwright from the PROJECT, not from this file.
 *
 * This script lives in a skill directory, and a bare `import("playwright")` resolves against
 * the importing module's own path — so it looked for playwright beside the skill and reported
 * "not installed" while sitting in a repo that had it. Resolving from the working directory is
 * what anyone running this actually means.
 */
async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch {
    /* not beside the skill; try the project */
  }
  try {
    const { createRequire } = await import("node:module");
    const { pathToFileURL } = await import("node:url");
    // The base file need not exist — createRequire only uses it to start the node_modules walk.
    const req = createRequire(path.join(process.cwd(), "package.json"));
    return await import(pathToFileURL(req.resolve("playwright")).href);
  } catch {
    return null;
  }
}

/**
 * Runs inside the page. Returns measurements, not verdicts — the decision about severity
 * belongs in Node where it can be read and changed.
 */
function probe() {
  const de = document.documentElement;
  /*
   * NOT window.innerWidth.
   *
   * Under mobile emulation Chromium WIDENS the layout viewport to fit overflowing content —
   * ask for 320 with 347px of content and innerWidth answers 347, so every off-edge test
   * silently passes on the page that is actually broken. documentElement.clientWidth stays
   * honest. This cost a real 27px overflow its first detection.
   */
  const vw = de.clientWidth;

  /*
   * THE CLIPPING-ANCESTOR RULE.
   *
   * An element parked past the right edge is only a defect if the user can actually see or
   * scroll to it. Inside a carousel, a drawer, or any scroller, being off-screen is the whole
   * design — a naive right-edge test flagged 39 correct cards on one real page.
   *
   * Walking up for a clipping ancestor is the general fix. Excluding the carousel's class name
   * would have been the specific one, and the next carousel would have a different name.
   */
  const clipped = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const ps = getComputedStyle(p);
      if (/hidden|clip|auto|scroll/.test(ps.overflowX) || /hidden|clip|auto|scroll/.test(ps.overflowY)) {
        return true;
      }
    }
    return false;
  };

  const offEdge = [];
  for (const el of document.querySelectorAll("body *")) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.right <= vw + 1 && r.left >= -1) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.opacity === "0" || cs.position === "fixed") continue;
    if (clipped(el)) continue;
    offEdge.push({
      tag: el.tagName.toLowerCase(),
      cls: (el.className?.baseVal ?? el.className ?? "").toString().slice(0, 60),
      left: Math.round(r.left),
      right: Math.round(r.right),
    });
    if (offEdge.length >= 12) break; // a dozen is plenty to diagnose from
  }

  /*
   * IS SOMETHING SITTING ON TOP OF THE PAGE?
   *
   * A cookie banner, a consent wall, a region notice, a first-run modal: the page beneath it
   * renders perfectly, every measurement passes, and the screenshot you are about to trust
   * shows the overlay. This is the single commonest way an inspection silently examines the
   * wrong thing, and it is invisible to every other check here — so look for a fixed element
   * with a real stacking order covering a large share of the viewport, and say so.
   */
  const vh = window.innerHeight;
  let overlay = null;
  for (const el of document.querySelectorAll("body *")) {
    const cs = getComputedStyle(el);
    if (cs.position !== "fixed" || cs.visibility === "hidden" || cs.opacity === "0") continue;
    if ((parseInt(cs.zIndex, 10) || 0) < 10) continue;
    const r = el.getBoundingClientRect();
    if (r.width * r.height < vw * vh * 0.5) continue;
    /*
     * A full-viewport layer only counts if it actually gets in the way — it paints something,
     * or it eats clicks. A well-built spotlight scrim is transparent AND pointer-events:none
     * precisely so it does neither, and flagging it would train you to ignore this warning
     * before the first real cookie wall ever showed up. Judge by behaviour, not by size.
     */
    const paints =
      !/^(rgba\(0, 0, 0, 0\)|transparent)$/.test(cs.backgroundColor) || cs.backdropFilter !== "none";
    if (!paints && cs.pointerEvents === "none") continue;
    overlay = {
      tag: el.tagName.toLowerCase(),
      cls: (el.className?.baseVal ?? el.className ?? "").toString().slice(0, 50),
      role: el.getAttribute("role") || "",
      z: cs.zIndex,
    };
    break;
  }

  /*
   * CONTENT THAT IS CLIPPED AND UNREACHABLE.
   *
   * This is the blind spot the clipping-ancestor rule above creates. That rule is right — an
   * element inside a scroller is not a layout bug — but it suppresses the case where the
   * container does not scroll at all: `overflow: hidden` holding more than it shows means
   * content no gesture can reach. On one real site this hid the market name the trader was
   * betting on (0px wide, 296px of text) and the chart's timeframe buttons (97px clipped),
   * while every other check reported the page clean.
   *
   * `auto` and `scroll` are excluded deliberately: those the user CAN swipe. Ellipsised text
   * is excluded too, because truncation there is a deliberate design choice, not loss.
   */
  const unreachable = [];
  for (const el of document.querySelectorAll("body *")) {
    const cs = getComputedStyle(el);
    if (!/^(hidden|clip)$/.test(cs.overflowX)) continue;
    /*
     * Ellipsis is a deliberate choice — but only while something is still legible. A flex
     * child squeezed to 3px renders the market name as "W…" above an order ticket quoting a
     * price, and the ellipsis is what makes it look intentional rather than broken. Below
     * 60px there is no truncation happening, only disappearance.
     */
    if (cs.textOverflow === "ellipsis" && el.clientWidth >= 60) continue;
    const hidden = el.scrollWidth - el.clientWidth;
    if (hidden < 8) continue; // below that is antialiasing
    /*
     * Skip screen-reader-only spans by their signature (a 1x1 box), not by a width floor.
     * A floor was the obvious guard and it was wrong: an element flex-squeezed to ZERO while
     * holding 296px of text is the most severe form of this defect, not the least, and any
     * "too narrow to matter" rule throws away precisely that case.
     */
    const box = el.getBoundingClientRect();
    if (box.width <= 1 && box.height <= 1) continue;
    /*
     * A PAGER'S HIDDEN CONTENT IS NOT UNREACHABLE — its controls are how you reach it.
     *
     * Carousels clip by design: `overflow: hidden` on the window, a track moved underneath by
     * transform, arrows to drive it. That is the single commonest legitimate instance of this
     * pattern, so without this the rule cries wolf on every hero deck and gets switched off.
     *
     * Recognise it by behaviour rather than by class name: a control that says next/previous,
     * or a child that is transformed or animates its transform. All three are what "something
     * moves content through this window" looks like in the computed style.
     */
    /*
     * A CONTROL THAT ANIMATES ITS OWN WIDTH IS DISCLOSING, NOT HIDING.
     *
     * A toolbar that collapses to a handle and expands on hover or focus is clipped at
     * rest by design, and its content is one gesture away. A genuinely broken clip has no
     * such intent, and the tell is in the computed style: the deliberate one TRANSITIONS
     * the very property doing the clipping. Static clipping of overflowing content does
     * not animate, because nothing was ever meant to move.
     *
     * Caught on a real collapsed toolbar that reported 215px "unreachable" while Tab
     * reached every button in it.
     */
    /*
     * ...and the same exemption applies to anything INSIDE a disclosure control.
     *
     * A collapsed rail hides its labels by clipping them to zero width while leaving them
     * in the DOM, which is the correct way to keep an icon-only link usable with a screen
     * reader. Checking only the flagged element missed that: the transition is on the
     * RAIL, the clipped thing is the label within it. Four levels is enough to cover a
     * rail > list > item > label without walking the whole document for every node.
     */
    let disclosed = false;
    for (let q = el, depth = 0; q && depth < 5; q = q.parentElement, depth++) {
      const qs = depth === 0 ? cs : getComputedStyle(q);
      if (/\b(max-width|width|all)\b/.test(qs.transitionProperty) && parseFloat(qs.transitionDuration) > 0) {
        disclosed = true;
        break;
      }
    }
    if (disclosed) continue;

    /*
     * Hidden text whose CONTROL is already named is a deliberate pattern, not loss.
     *
     * An icon-only link in a collapsed rail keeps its label in the DOM for assistive tech
     * and carries `title`/`aria-label` so a pointer user can get it too. Both audiences
     * are served; nothing is unreachable. A market name squeezed to zero by a flex parent
     * has no named control above it and still reports.
     */
    if (box.width < 1) {
      let named = false;
      for (let q = el.parentElement, d = 0; q && d < 3; q = q.parentElement, d++) {
        if (q.title || q.getAttribute("aria-label")) {
          named = true;
          break;
        }
      }
      if (named) continue;
    }

    const isPager =
      !!el.querySelector(
        '[aria-label*="next" i], [aria-label*="prev" i], [aria-label*="slide" i], [role="tablist"]',
      ) ||
      [...el.children].some((c) => {
        const ccs = getComputedStyle(c);
        if (/transform/.test(ccs.transitionProperty)) return true;
        const m = ccs.transform.match(/matrix\(([^)]+)\)/);
        return m ? Math.abs(parseFloat(m[1].split(",")[4])) > 0.5 : false;
      });
    if (isPager) continue;

    const interactive = el.querySelector("a[href], button, input, select, textarea, [tabindex]");
    const text = (el.innerText || "").trim();
    if (!interactive && !text) continue;
    unreachable.push({
      tag: el.tagName.toLowerCase(),
      cls: (el.className?.baseVal ?? el.className ?? "").toString().slice(0, 50),
      hidden,
      shown: el.clientWidth,
      interactive: !!interactive,
      sample: text.slice(0, 40),
    });
    if (unreachable.length >= 8) break;
  }

  return {
    scrollW: de.scrollWidth,
    clientW: de.clientWidth,
    offEdge,
    unreachable,
    overlay,
    links: document.querySelectorAll("a[href], button").length,
    text: (document.body.innerText || "").trim().length,
    title: document.title,
  };
}

async function main() {
  const cli = parseArgs(process.argv.slice(2));
  if (cli.help) {
    console.log(HELP);
    return 0;
  }

  const file = cli.config ? JSON.parse(readFileSync(cli.config, "utf8")) : {};
  const base = (cli.base || file.base || "").replace(/\/+$/, "");
  const rawRoutes = cli.routes.length ? cli.routes : file.routes?.length ? file.routes : ["/"];
  const routes = rawRoutes.map(unmangleRoute);
  if (routes.some((r, n) => r !== rawRoutes[n])) {
    console.log("note: recovered routes mangled by Git Bash path conversion ->", routes.join(" "));
  }
  const viewports = cli.viewports || file.viewports || DEFAULT_VIEWPORTS;
  const outDir = path.resolve(cli.out || file.out || "./ui-inspect");
  const storage = { ...(file.storage || {}), ...cli.storage };
  const basic = cli.basic || file.basic || null;
  const timeout = cli.timeout || file.timeout || 20000;
  const waitFor = file.waitFor || null;

  if (!base) {
    console.error("need --base <url>  (or a --config with one)\n" + HELP);
    return 2;
  }

  const pw = await loadPlaywright();
  if (!pw) {
    console.error(
      `playwright not found from ${process.cwd()}\n` +
        "  npm i -D playwright && npx playwright install chromium",
    );
    return 2;
  }
  // playwright is CJS: imported by file URL the named exports are not always detected, and the
  // real module object lands on `.default`. Accept either shape.
  const { chromium } = pw.chromium ? pw : (pw.default ?? pw);
  if (!chromium) {
    console.error("playwright loaded but exposes no chromium export — check the install");
    return 2;
  }

  /*
   * HARNESS CHECK FIRST.
   *
   * A dead preview server once produced 48 failures that all read like real defects. Every one
   * was a page that never loaded. Two seconds here saves an hour of debugging an app that is
   * fine — so this refuses to run rather than hand back a wall of lies.
   */
  const probeRes = await fetch(base, { redirect: "follow" }).catch(() => null);
  if (!probeRes) {
    console.error(`cannot reach ${base} — start the server before blaming the app`);
    return 2;
  }
  console.log(`harness ok: ${base} -> ${probeRes.status}\n`);

  await mkdir(outDir, { recursive: true });
  const browser = await chromium.launch();
  const findings = [];
  const stats = [];
  let renders = 0;

  for (const vp of viewports) {
    const ctx = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: 1,
      ...(basic ? { httpCredentials: basic } : {}),
    });
    if (Object.keys(storage).length) {
      await ctx.addInitScript((kv) => {
        try {
          for (const [k, v] of Object.entries(kv)) localStorage.setItem(k, v);
        } catch {
          /* storage blocked; the app should cope, and if it does not that is a finding */
        }
      }, storage);
    }
    if (cli.init || file.init) {
      await ctx.addInitScript({ path: path.resolve(cli.init || file.init) });
    }

    for (const route of routes) {
      const page = await ctx.newPage();
      /*
       * SEVERITY BY WHETHER THE USER IS ACTUALLY HURT, not by where the message came from.
       *
       * Treating every console error as a failure sounds rigorous and is useless in practice:
       * a signed-out inspection legitimately gets 401s from authed endpoints, and a blocked
       * analytics beacon is a config note, not a broken page. Both appear on every run of a
       * healthy app, and a check that always fails gets switched off — taking the uncaught
       * exception it was really there to catch with it.
       *
       * So: an uncaught exception or a 5xx breaks the page and fails. Everything else surfaces
       * as a warning, with its status visible, for you to judge.
       */
      const errors = [];
      page.on("pageerror", (e) => errors.push(["FAIL", `uncaught: ${e.message.split("\n")[0]}`]));
      page.on("console", (m) => {
        if (m.type() !== "error") return;
        const text = m.text().slice(0, 200);
        const status = text.match(/status of (\d{3})/)?.[1];
        errors.push([status && status[0] === "5" ? "FAIL" : "WARN", `console: ${text}`]);
      });

      const url = base + route;
      const where = `${route} @ ${vp.name}`;
      /*
       * `key` groups findings that are the SAME DEFECT wearing different text. Seven clipped
       * usernames in a trade tape are one component reported seven times, and printing all
       * seven buries the single 272px market name underneath them. The message still shows
       * the first instance's text; only the counting is by component.
       */
      const add = (level, msg, key) =>
        findings.push({ level, route, viewport: vp.name, msg, key: key || msg });

      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout });
        if (waitFor) await page.waitForSelector(waitFor, { timeout }).catch(() => {});
        // Let fonts, images and the first paint settle; layout measured too early lies.
        await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
        /*
         * NETWORK QUIET IS NOT THE SAME AS RENDERED.
         *
         * A code-split route fetches its chunk, the network goes idle, and only THEN
         * does the router mount it — so measuring at networkidle catches the boot
         * splash. On a cold dev server that produced "no links or buttons — is this an
         * error boundary?" on a different route at a different viewport on every single
         * run. A finding that moves each time is a timing artifact, and one that reads
         * exactly like a crashed page is the worst kind: it trains you to ignore the
         * check that would have caught a real one.
         *
         * So wait for the DOM to stop CHANGING rather than for the network to stop
         * talking: sample the control count and text length until two consecutive
         * samples agree. A genuinely broken route never gains content, so it settles
         * immediately at zero and still reports — this suppresses the false positive
         * without suppressing the case the check exists for.
         */
        {
          const sample = () =>
            page.evaluate(() => ({
              n: document.querySelectorAll("a,button,input,select,textarea").length,
              t: (document.body?.innerText || "").length,
            }));
          let prev = await sample();
          for (let i = 0; i < 20; i++) {
            await page.waitForTimeout(250);
            const now = await sample();
            /*
             * STABLE IS NOT ENOUGH — A BOOT SPLASH IS PERFECTLY STABLE.
             *
             * The first version of this broke out as soon as two samples agreed, and a
             * "Loading…" screen agrees with itself instantly, so it measured the splash
             * and reported an error boundary. Settling only counts once the page has
             * actual controls on it. A route that is genuinely broken never gains any,
             * so it runs out the budget and still reports — which is the case this check
             * exists for, and the one that must survive the fix.
             */
            if (now.n === prev.n && now.t === prev.t && now.n >= 2) break;
            prev = now;
          }
        }
        await page.waitForTimeout(350);

        const r = await page.evaluate(probe);
        const shot = path.join(outDir, `${slug(route)}__${vp.width}x${vp.height}.png`);
        await page.screenshot({ path: shot, fullPage: !!(cli.fullPage || file.fullPage) });
        renders++;

        for (const [level, msg] of errors) add(level, msg);
        if (r.scrollW > r.clientW + 1) {
          add("FAIL", `horizontal scroll: ${r.scrollW}px content in ${r.clientW}px viewport`);
        }
        for (const el of r.offEdge) {
          add("WARN", `past right edge: <${el.tag} class="${el.cls}"> right=${el.right}`);
        }
        for (const u of r.unreachable) {
          add(
            "WARN",
            `clipped and unreachable: <${u.tag} class="${u.cls}"> hides ${u.hidden}px ` +
              `(shows ${u.shown}px, overflow:hidden so it cannot be scrolled)` +
              (u.interactive ? " — CONTAINS CONTROLS" : ` — "${u.sample}"`),
            `unreachable:${u.tag}.${u.cls}`,
          );
        }
        if (r.overlay) {
          const o = r.overlay;
          add(
            "WARN",
            `overlay covers the page: <${o.tag} class="${o.cls}" role="${o.role}"> z=${o.z}` +
              " — the screenshot shows this, not the UI beneath it",
          );
        }
        if (r.links === 0) add("WARN", "no links or buttons — is this an error boundary?");
        if (r.text < 40) add("WARN", `only ${r.text} chars of visible text`);
        stats.push({ route, viewport: vp.name, sig: `${r.links}/${r.text}` });

        const bad = findings.filter((f) => f.route === route && f.viewport === vp.name);
        const tag = bad.some((f) => f.level === "FAIL") ? "FAIL" : bad.length ? "warn" : "ok  ";
        console.log(`${tag}  ${where.padEnd(38)} ${r.links} links, ${r.text} chars`);
      } catch (e) {
        add("FAIL", `navigation failed: ${e.message.split("\n")[0]}`);
        console.log(`FAIL  ${where.padEnd(38)} ${e.message.split("\n")[0]}`);
      }
      await page.close();
    }
    await ctx.close();
  }
  await browser.close();

  /*
   * EVERY ROUTE RENDERED THE SAME THING.
   *
   * The tell for an app sitting behind a launch gate, a login wall or a paywall: each route
   * reports an identical link and text count, because each one is really the same gate page.
   * Nothing else here can see that — the gate is a perfectly healthy page — so the run comes
   * back clean and you inspect a UI you never actually loaded. Ask for it once, here.
   */
  if (routes.length > 1) {
    for (const vp of viewports) {
      const seen = stats.filter((s) => s.viewport === vp.name);
      if (seen.length === routes.length && new Set(seen.map((s) => s.sig)).size === 1) {
        findings.push({
          level: "WARN",
          route: "(all)",
          viewport: vp.name,
          msg: "every route rendered identically — a gate or login wall? seed it with --storage",
        });
      }
    }
  }

  const fails = findings.filter((f) => f.level === "FAIL");
  const warns = findings.filter((f) => f.level === "WARN");

  /*
   * ONE LINE PER DISTINCT PROBLEM, not one per occurrence.
   *
   * A site-wide issue — a blocked third-party script, an endpoint 401ing while signed out —
   * reproduces on every route at every size, so a raw dump buries the single real regression
   * under fifty copies of a thing you already knew. Collapse by message and count instead:
   * the count is itself the useful signal, because "28 of 28" reads as configuration and
   * "1 of 28" reads as a bug at one breakpoint.
   */
  if (findings.length) {
    const groups = new Map();
    for (const f of findings) {
      const k = `${f.level} :: ${f.key ?? f.msg}`;
      if (!groups.has(k)) groups.set(k, { ...f, n: 0, where: [] });
      const g = groups.get(k);
      g.n++;
      if (g.where.length < 3) g.where.push(`${f.route}@${f.viewport}`);
    }
    console.log("\n── findings ──");
    for (const g of groups.values()) {
      const scope = g.n === 1 ? g.where[0] : `${g.n}x  ${g.where.join(", ")}${g.n > 3 ? ", …" : ""}`;
      console.log(`  ${g.level}  ${g.msg.slice(0, 150)}\n        ${scope}`);
    }
  }

  console.log(
    `\n${fails.length} fail, ${warns.length} warn, ${renders} renders   (${base})` +
      `\nscreenshots: ${outDir}`,
  );

  if (cli.json) {
    await writeFile(cli.json, JSON.stringify({ base, renders, findings }, null, 2));
  }

  /*
   * A clean run is the START of the check, not the end of it. Nothing above can see a page
   * that rendered unstyled, a tooltip covering its own target, or a layout that is merely
   * ugly. Open the widest and the narrowest PNG before you call this done.
   */
  if (!findings.length) console.log("\nnow open the widest and narrowest screenshots and look at them.");

  return fails.length ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(e);
    process.exit(2);
  },
);
