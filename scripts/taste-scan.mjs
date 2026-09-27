#!/usr/bin/env node
/**
 * Taste scan — the measurable half of "this doesn't look designed".
 *
 * `inspect.mjs` finds defects: things that are broken. This finds the things that are merely
 * WRONG — and it only reports what can be counted, because a rubric that emits opinions
 * produces "improve the visual hierarchy" and nobody can act on that.
 *
 * ── THE CENTRAL IDEA: UNINTENDED VARIETY ─────────────────────────────────────
 *
 * A page that was designed has few distinct values; a page that accreted has many. Nobody
 * chooses 13px AND 14px AND 13.6px — those are three people, three dates, and no scale. So
 * the strongest objective evidence of taste failure is the NEAR MISS: two values close
 * enough that the difference cannot have been intentional, but not equal.
 *
 * A near miss is not a matter of opinion. Two left edges 3px apart is a mistake in a way
 * that two edges 40px apart is not, whatever your design philosophy.
 *
 * ── WHAT IT CANNOT DO ────────────────────────────────────────────────────────
 *
 * It cannot tell you the page is ugly, or that the metaphor is wrong, or that the hierarchy
 * puts the wrong thing first. Those need eyes, and references/taste.md is how to use them.
 * This script exists so your eyes are spent on those, and not on counting greys.
 *
 * Usage
 *   node taste-scan.mjs --base https://example.com --routes / /pricing --accent "#efdc2e"
 */

import { writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_VIEWPORTS = [
  { name: "phone", width: 390, height: 844 },
  { name: "desktop", width: 1440, height: 900 },
];

/*
 * Tolerances: below these, two values are a mistake rather than a decision.
 *
 * Deliberately tight. The aim is findings nobody can argue with — a 1.5px type step is not a
 * type step — rather than a long list of things that are merely close. Raising these produces
 * more findings and fewer that anyone acts on.
 */
const NEAR = {
  /*
   * Type is compared by RATIO, not by pixels, because perception is.
   *
   * An absolute tolerance gets this backwards at both ends. 1.6px called 9->10 a mistake
   * on a dense trading UI where it is an 11% step and plainly a real one; the same
   * tolerance would wave through 40->41 on a display face, where it is invisible. 8% is
   * roughly where a size change stops reading as deliberate: it clears every step of a
   * minor-second scale (1.125) and still catches every half-pixel pair — 13 vs 13.5 is
   * 3.8%, 11 vs 11.5 is 4.5%.
   */
  fontRatio: 1.08,
  edgePx: 4, // two columns 3px apart were meant to line up
  radiusPx: 2,
  colorDeltaE: 3.5, // roughly "same colour to the eye, different in the stylesheet"
};

const HELP = `
taste scan — countable evidence of unintended variety

  --base <url>        origin to scan
  --routes <p> [p...] paths (default: /)
  --viewports <list>  e.g. 390x844,1440x900 (default: phone + desktop)
  --accent <hex>      brand accent, to measure how much of the page it covers
  --storage k=v       seed localStorage before boot; repeatable
  --json <file>       write the full result
  --top <n>           offenders listed per finding (default 6)

Reports type scale, colour count, near-miss edges and radii, accent load, tap targets,
text measure, and contrast. Every number is a count or a pixel value; nothing here is an
opinion. Read references/taste.md for the judgements this cannot make.
`;

const MSYS = /^[A-Za-z]:[\\/].*?(?:Git|msys64|mingw64|usr)[\\/]/i;
const unmangle = (r) =>
  /^[A-Za-z]:[\\/]/.test(r) && MSYS.test(r)
    ? "/" + r.slice(r.match(MSYS)[0].length).replace(/\\/g, "/").replace(/^\/+/, "")
    : r;

function parseArgs(argv) {
  const o = { routes: [], storage: {}, top: 6 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === "--help" || a === "-h") o.help = true;
    else if (a === "--base") o.base = next();
    else if (a === "--accent") o.accent = next();
    else if (a === "--json") o.json = next();
    else if (a === "--top") o.top = Number(next());
    else if (a === "--viewports")
      o.viewports = next()
        .split(",")
        .map((s) => {
          const [w, h] = s.trim().split("x").map(Number);
          return { name: `${w}x${h}`, width: w, height: h };
        });
    else if (a === "--storage") {
      const [k, ...rest] = next().split("=");
      o.storage[k] = rest.join("=");
    } else if (a === "--routes") {
      while (argv[i + 1] && !argv[i + 1].startsWith("--")) o.routes.push(unmangle(argv[++i]));
    }
  }
  return o;
}

async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch {
    /* try the project */
  }
  try {
    const { createRequire } = await import("node:module");
    const { pathToFileURL } = await import("node:url");
    const req = createRequire(path.join(process.cwd(), "package.json"));
    return await import(pathToFileURL(req.resolve("playwright")).href);
  } catch {
    return null;
  }
}

/** Runs in the page. Collects raw measurements; every judgement happens in Node. */
function collect(accentHex) {
  // documentElement.clientWidth, not innerWidth: under mobile emulation Chromium widens the
  // layout viewport to fit overflowing content, so innerWidth lies on exactly the pages worth
  // measuring. Same trap that once hid a real 27px overflow.
  const vw = document.documentElement.clientWidth;
  const px = (v) => Math.round(parseFloat(v) * 10) / 10;
  const rgb = (s) => {
    const m = String(s).match(/-?[\d.]+/g);
    return m && m.length >= 3 ? [+m[0], +m[1], +m[2], m.length > 3 ? +m[3] : 1] : null;
  };
  const lum = ([r, g, b]) => {
    const f = (c) => {
      c /= 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (a, b) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };

  /** Composite one RGBA layer over an opaque colour beneath it. */
  const over = (top, under) =>
    top[3] >= 0.999
      ? top.slice(0, 3)
      : [0, 1, 2].map((i) => top[i] * top[3] + under[i] * (1 - top[3]));

  /**
   * What is ACTUALLY behind this text, with translucency composited.
   *
   * The first version stopped at the first layer with any alpha and used its raw colour.
   * That reported `rgb(99,92,81)` text as 1.1:1 — invisible — on a page where every one of
   * its 276 instances measures between 6.6:1 and 18.5:1, because a `rgba(0,0,0,.5)` panel
   * in the chain was read as pure black instead of the mid-grey it paints. A half-opaque
   * layer is half of what is under it, so you have to keep walking and blend.
   *
   * Getting this wrong does not merely add noise, it inverts the result: it invents
   * failures on compliant text while a genuinely faint label elsewhere is never read.
   *
   * A GRADIENT IS NOT A PHOTOGRAPH. Both are `background-image`, and lumping them together
   * made eleven gradient cards read as "contrast indeterminate" — false, since a gradient
   * is a known pair of colours. A `url()` is arbitrary content whose contrast moves with
   * the picture, and that can only be scrimmed.
   */
  const backdrop = (el) => {
    const layers = [];
    for (let p = el; p; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (/url\(/.test(cs.backgroundImage)) return { over: "photo" };
      if (cs.backgroundImage && cs.backgroundImage !== "none") return { over: "gradient" };
      const c = rgb(cs.backgroundColor);
      if (!c || c[3] === 0) continue;
      layers.push(c);
      if (c[3] >= 0.999) break;
    }
    let out = [255, 255, 255]; // the page beneath everything
    for (let i = layers.length - 1; i >= 0; i--) out = over(layers[i], out);
    return { color: out };
  };

  const fonts = new Map();
  const colors = new Map();
  const radii = new Map();
  const edges = new Map();
  const small = [];
  const longLines = [];
  const lowContrast = [];
  const overMedia = [];
  let accentArea = 0;


  const accent = accentHex ? rgb(accentHex.replace(/^#?/, "").length === 6
    ? `rgb(${parseInt(accentHex.slice(-6, -4), 16)},${parseInt(accentHex.slice(-4, -2), 16)},${parseInt(accentHex.slice(-2), 16)})`
    : accentHex) : null;
  const closeTo = (a, b, t = 26) =>
    a && b && Math.abs(a[0] - b[0]) < t && Math.abs(a[1] - b[1]) < t && Math.abs(a[2] - b[2]) < t;

  const label = (el) => {
    const cls = (el.className?.baseVal ?? el.className ?? "").toString().trim().split(/\s+/)[0];
    return `${el.tagName.toLowerCase()}${cls ? "." + cls.slice(0, 24) : ""}`;
  };

  for (const el of document.querySelectorAll("body *")) {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    if (r.bottom < 0 || r.top > window.innerHeight * 3) continue; // roughly on-page
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.opacity === "0" || cs.display === "none") continue;
    /*
     * `aria-hidden` TEXT IS DECORATION, AND DECORATION HAS NO CONTRAST DUTY.
     *
     * A breadcrumb's "/" and a chip's "·" are glyphs drawn in the hairline
     * colour on purpose: they are structure made visible, they carry nothing a
     * reader needs, and the author has already said so in the one place that
     * is checkable. Counting them reported the same two runs at 1.9:1 on every
     * page of a product whose real text is all above 4.5 — which is how a
     * contrast check gets switched off before the day it finds something.
     *
     * Named at the RULE rather than by excusing a component, because the next
     * decorative separator will have a different class. WCAG 1.4.3 exempts
     * incidental and decorative text for exactly this reason.
     */
    if (el.closest("[aria-hidden='true']")) continue;

    /*
     * Accent load is measured against the VIEWPORT, not the sum of element areas.
     *
     * Summing every element's box double-counts every nesting level — a page ten divs deep
     * reports ten times its own area — so a genuinely prominent yellow button came out as
     * "0% of laid-out area". The question anyone actually asks is "how much of the screen is
     * accent", and the screen is one fixed size.
     */
    void 0;

    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());

    if (own) {
      const fs = px(cs.fontSize);
      fonts.set(fs, (fonts.get(fs) || 0) + 1);
      const col = cs.color;
      colors.set(col, (colors.get(col) || 0) + 1);

      const bg = backdrop(el);
      const fg = rgb(col);
      if (bg.over) {
        overMedia.push({ el: label(el), kind: bg.over, color: col, text: el.innerText.trim().slice(0, 40) });
      } else if (fg && bg.color) {
        // The TEXT can be translucent too — a 34%-white caption is not white. Composite it
        // over the surface it sits on before measuring, or every muted label scores as if
        // it were fully opaque and the check passes exactly where it should fail.
        const cr = Math.round(ratio(over(fg, bg.color), bg.color) * 10) / 10;
        const big = fs >= 24 || (fs >= 18.66 && Number(cs.fontWeight) >= 700);
        if (cr < (big ? 3 : 4.5)) {
          lowContrast.push({
            el: label(el),
            ratio: cr,
            need: big ? 3 : 4.5,
            size: fs,
            text: el.innerText.trim().slice(0, 40),
          });
        }
      }

      // Measure: characters per line, the classic readability bound.
      const chars = el.innerText.trim().length;
      if (chars > 90 && cs.display.includes("block")) {
        const perLine = r.width / (fs * 0.5); // ~0.5em average advance
        if (perLine > 90) longLines.push({ el: label(el), ch: Math.round(perLine) });
      }
    }

    const rad = px(cs.borderTopLeftRadius);
    if (rad > 0) radii.set(rad, (radii.get(rad) || 0) + 1);

    /*
     * A COLUMN, not a containment.
     *
     * This counted every element's left edge, so any container with a border or padding
     * near-missed against its own flush contents: a 1px-bordered tile sits at 248 and
     * everything inside it at 249, and the report read that as two columns that almost
     * line up. It was the tile's border, every time, and no amount of nudging could fix
     * it because nothing was wrong.
     *
     * An element sitting flush inside its parent's content box is not an independent
     * column — it IS its parent, inset by the box the parent already declares. Only
     * edges that differ from that tell you anything about alignment.
     */
    if (r.width > 60 && r.height > 20) {
      const pe = el.parentElement;
      let flush = false;
      if (pe) {
        const pr = pe.getBoundingClientRect();
        const pcs = getComputedStyle(pe);
        const contentLeft = pr.left + px(pcs.borderLeftWidth) + px(pcs.paddingLeft);
        flush = Math.abs(r.left - contentLeft) < 0.75;
      }
      if (!flush) edges.set(Math.round(r.left), (edges.get(Math.round(r.left)) || 0) + 1);
    }

    if (accent) {
      const bgc = rgb(cs.backgroundColor);
      // Clip to the viewport: an accent band running off-screen only accents what is on it.
      if (closeTo(bgc, accent) && bgc[3] > 0.5) {
        const w = Math.min(r.right, window.innerWidth) - Math.max(r.left, 0);
        const h = Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0);
        if (w > 0 && h > 0) accentArea += w * h;
      }
    }

    /*
     * TAP TARGETS ARE HIT-TESTED, NOT MEASURED.
     *
     * A bounding box is the wrong instrument here, for two opposite reasons:
     *
     *  - It UNDER-reports. The standard way to enlarge a small control without changing how
     *    it looks is an absolutely-positioned ::after that extends its hit region. The
     *    pseudo-element is not in the box, so a 24x5 pager dot with a proper 30x40 tap area
     *    still measures 24x5 — and a scan that only measures reports a fixed control as
     *    broken, forever.
     *  - It OVER-reports. A 44x44 button with something overlapping half of it is 44x44 to
     *    `getBoundingClientRect` and unreachable to a thumb.
     *
     * So ask the page what a tap would actually hit. Probe outward from the centre with
     * elementFromPoint until the control stops answering. That is the number a finger gets,
     * which is the only number the guideline is about.
     */
    if (el.matches("a[href], button, input, select, [role='button'], [role='tab']")) {
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const owns = (x, y) => {
        const hit = document.elementFromPoint(x, y);
        return !!hit && (hit === el || el.contains(hit) || hit.parentElement === el);
      };
      // Only worth probing when the box itself is small; a big box is already fine.
      if ((r.width < 44 || r.height < 44) && owns(cx, cy)) {
        /*
         * Probe exactly far enough to settle the question and no further: 22px each way
         * makes 45, which clears 44. A larger cap reads as a measurement when it is really
         * the limit of the loop — an earlier version probed 30 and reported every wide
         * control as "61", which is 30+30+1 and tells you nothing about the control.
         */
        const CAP = 22;
        const reach = (dx, dy) => {
          let n = 0;
          for (let d = 1; d <= CAP; d++) {
            if (!owns(cx + dx * d, cy + dy * d)) break;
            n = d;
          }
          return n;
        };
        const cap = (v) => (v >= CAP * 2 + 1 ? "44+" : v);
        const hitW = reach(-1, 0) + reach(1, 0) + 1;
        const hitH = reach(0, -1) + reach(0, 1) + 1;
        if (hitW < 44 || hitH < 44) {
          small.push({
            el: label(el),
            w: Math.round(r.width),
            h: Math.round(r.height),
            hitW,
            hitH,
            show: `${cap(hitW)}x${cap(hitH)}`,
          });
        }
      }
    }
  }

  /*
   * CHROME LOAD — Apple's "deference", as a number.
   *
   * Sum the fixed and sticky furniture and compare it to the screen. Only OUTERMOST pieces
   * count: a toolbar's buttons are fixed too, and counting them as well reports a header
   * three or four times and turns a real metric into noise. Clipped to the viewport, because
   * chrome that runs off-screen only defers on the part you can see.
   */
  const chrome = [];
  for (const el of document.querySelectorAll("body *")) {
    const cs = getComputedStyle(el);
    if (cs.position !== "fixed" && cs.position !== "sticky") continue;
    if (cs.visibility === "hidden" || cs.opacity === "0") continue;
    /*
     * A BACKDROP IS NOT CHROME, and neither is a click-through layer.
     *
     * Position:fixed alone counted a full-viewport decorative canvas at z-index -10 and a
     * pointer-events:none overlay, and reported 120% chrome on a page whose real furniture
     * is about a fifth of the screen. Chrome is what takes space FROM content: it has to sit
     * in front, and it has to either paint or catch clicks. Something behind the content is
     * wallpaper, and something transparent you can click through is not there at all.
     */
    const z = parseInt(cs.zIndex, 10);
    if (Number.isFinite(z) && z < 0) continue;
    const paints =
      !/^(rgba\(0, 0, 0, 0\)|transparent)$/.test(cs.backgroundColor) || cs.backdropFilter !== "none";
    if (!paints && cs.pointerEvents === "none") continue;
    let nested = false;
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const pp = getComputedStyle(p).position;
      if (pp === "fixed" || pp === "sticky") {
        nested = true;
        break;
      }
    }
    if (nested) continue;
    const r = el.getBoundingClientRect();
    const w = Math.min(r.right, vw) - Math.max(r.left, 0);
    const h = Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0);
    if (w > 0 && h > 0 && w * h > 400) {
      chrome.push({ el: label(el), area: Math.round(w * h), w: Math.round(w), h: Math.round(h) });
    }
  }

  return {
    chromePct:
      Math.round(
        (chrome.reduce((s, c) => s + c.area, 0) / (vw * window.innerHeight)) * 1000,
      ) / 10,
    chrome: chrome.sort((a, b) => b.area - a.area).slice(0, 5),
    fonts: [...fonts].sort((a, b) => a[0] - b[0]),
    colors: [...colors].sort((a, b) => b[1] - a[1]),
    radii: [...radii].sort((a, b) => a[0] - b[0]),
    edges: [...edges].filter(([, n]) => n >= 2).sort((a, b) => a[0] - b[0]),
    small,
    longLines,
    lowContrast,
    overMedia,
    accentPct: Math.round((accentArea / (window.innerWidth * window.innerHeight)) * 1000) / 10,
  };
}

/** Values close enough that the gap cannot have been chosen. */
function nearMisses(values, tol) {
  const out = [];
  for (let i = 1; i < values.length; i++) {
    const d = values[i][0] - values[i - 1][0];
    if (d > 0 && d < tol) out.push({ a: values[i - 1][0], b: values[i][0], gap: Math.round(d * 10) / 10 });
  }
  return out;
}

/**
 * "Are these the same colour?" — including alpha, which the first version dropped.
 *
 * Without it `rgb(255,255,255)` and `rgba(255,255,255,0.34)` compared as identical and got
 * reported as an accidental duplicate. They are nothing of the kind: one is body text and
 * the other is a muted caption, and calling that a mistake teaches the reader to stop
 * reading this section. Opacity is how most design systems express hierarchy, so ignoring
 * it does not simplify the comparison — it inverts it.
 */
function deltaish(c1, c2) {
  const parse = (s) => {
    const n = (String(s).match(/-?[\d.]+/g) || []).map(Number);
    return n.length >= 3 ? { rgb: n.slice(0, 3), a: n.length > 3 ? n[3] : 1 } : null;
  };
  const [a, b] = [parse(c1), parse(c2)];
  if (!a || !b) return 999;
  if (Math.abs(a.a - b.a) > 0.08) return 999; // a different alpha is a different colour
  // Crude but adequate: weighted RGB distance, roughly perceptual.
  const d = (i, w) => w * (a.rgb[i] - b.rgb[i]) ** 2;
  return Math.sqrt(d(0, 2) + d(1, 4) + d(2, 3)) / 3;
}

async function main() {
  const cli = parseArgs(process.argv.slice(2));
  if (cli.help || !cli.base) {
    console.log(HELP);
    return cli.base ? 0 : 2;
  }
  const pw = await loadPlaywright();
  if (!pw) {
    console.error(`playwright not found from ${process.cwd()}\n  npm i -D playwright`);
    return 2;
  }
  const { chromium } = pw.chromium ? pw : (pw.default ?? pw);

  const base = cli.base.replace(/\/+$/, "");
  const routes = cli.routes.length ? cli.routes : ["/"];
  const viewports = cli.viewports || DEFAULT_VIEWPORTS;

  if (!(await fetch(base).catch(() => null))) {
    console.error(`cannot reach ${base}`);
    return 2;
  }

  const browser = await chromium.launch();
  const all = [];

  for (const vp of viewports) {
    const ctx = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      hasTouch: vp.width <= 820,
    });
    if (Object.keys(cli.storage).length) {
      await ctx.addInitScript((kv) => {
        try {
          for (const [k, v] of Object.entries(kv)) localStorage.setItem(k, v);
        } catch {}
      }, cli.storage);
    }
    for (const route of routes) {
      const page = await ctx.newPage();
      try {
        await page.goto(base + route, { waitUntil: "domcontentloaded", timeout: 20000 });
        await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
        await page.waitForTimeout(400);
        const r = await page.evaluate(collect, cli.accent || null);
        all.push({ route, viewport: vp.name, touch: vp.width <= 820, ...r });
      } catch (e) {
        console.log(`skip ${route} @ ${vp.name}: ${e.message.split("\n")[0]}`);
      }
      await page.close();
    }
    await ctx.close();
  }

  /*
   * DOES IT HONOUR prefers-reduced-motion?
   *
   * Not a heuristic — ask the browser. Load the page with the preference set and list the
   * animations still running forever. `getAnimations()` is the ground truth: it sees CSS
   * animations, transitions and the Web Animations API alike, so a guard that covers only
   * the stylesheet still gets caught.
   *
   * Infinite iterations only. A one-shot fade under reduced motion is a judgement call; a
   * loop that never stops is what makes people motion-sick, and it is what the preference
   * exists to turn off.
   */
  const rmCtx = await browser.newContext({
    viewport: { width: viewports[0].width, height: viewports[0].height },
    reducedMotion: "reduce",
  });
  if (Object.keys(cli.storage).length) {
    await rmCtx.addInitScript((kv) => {
      try {
        for (const [k, v] of Object.entries(kv)) localStorage.setItem(k, v);
      } catch {}
    }, cli.storage);
  }
  const motion = [];
  for (const route of routes) {
    const page = await rmCtx.newPage();
    try {
      await page.goto(base + route, { waitUntil: "domcontentloaded", timeout: 20000 });
      await page.waitForTimeout(2500);
      const still = await page.evaluate(() =>
        document
          .getAnimations()
          .filter((a) => a.playState === "running" && a.effect?.getTiming().iterations === Infinity)
          .map((a) => {
            const t = a.effect?.target;
            const cls = t ? (t.className?.baseVal ?? t.className ?? "").toString().split(/\s+/)[0] : "";
            return `${t ? t.tagName.toLowerCase() : "?"}${cls ? "." + cls.slice(0, 20) : ""}`;
          }),
      );
      if (still.length) motion.push({ route, els: still });
    } catch {
      /* the main pass already reported anything unreachable */
    }
    await page.close();
  }
  await rmCtx.close();
  await browser.close();

  const N = cli.top;
  const list = (xs, f) => xs.slice(0, N).map(f).join(", ") + (xs.length > N ? `, +${xs.length - N}` : "");

  for (const r of all) {
    console.log(`\n══ ${r.route} @ ${r.viewport} ${"═".repeat(Math.max(0, 40 - r.route.length))}`);

    const fsizes = r.fonts.map((f) => f[0]);
    console.log(`  type scale     ${r.fonts.length} sizes: ${fsizes.join(" ")}`);
    const fn = [];
    for (let i = 1; i < r.fonts.length; i++) {
      const [a, b] = [r.fonts[i - 1][0], r.fonts[i][0]];
      if (a > 0 && b / a < NEAR.fontRatio) {
        fn.push({ a, b, gap: Math.round((b - a) * 10) / 10 });
      }
    }
    if (fn.length) console.log(`   ! near-miss   ${list(fn, (x) => `${x.a}/${x.b}px`)}  — not a scale step`);
    if (r.fonts.length > 8) console.log(`   ! too many    ${r.fonts.length} sizes; a scale is usually 5-7`);

    console.log(`  text colours   ${r.colors.length}`);
    const cn = [];
    for (let i = 0; i < r.colors.length; i++)
      for (let j = i + 1; j < r.colors.length; j++)
        if (deltaish(r.colors[i][0], r.colors[j][0]) < NEAR.colorDeltaE)
          cn.push(`${r.colors[i][0]}~${r.colors[j][0]}`);
    if (cn.length) console.log(`   ! near-miss   ${list(cn, (x) => x)}  — same to the eye, different in CSS`);

    if (r.radii.length) {
      console.log(`  radii          ${r.radii.map((x) => x[0]).join(" ")}`);
      const rn = nearMisses(r.radii, NEAR.radiusPx);
      if (rn.length) console.log(`   ! near-miss   ${list(rn, (x) => `${x.a}/${x.b}px`)}`);
    }

    const en = nearMisses(r.edges, NEAR.edgePx);
    if (en.length)
      console.log(`   ! alignment   ${list(en, (x) => `${x.a}/${x.b} (${x.gap}px)`)}  — columns that nearly line up`);

    if (r.chromePct != null) {
      const heavy = r.touch && r.chromePct > 25 ? " — on a phone that is a lot; content is the tenant" : "";
      console.log(
        `  chrome load    ${r.chromePct}% of the viewport${heavy}` +
          (r.chrome.length ? `  [${list(r.chrome, (c) => `${c.el} ${c.w}x${c.h}`)}]` : ""),
      );
    }
    if (cli.accent) {
      const verdict =
        r.accentPct > 15 ? " — heavy; an accent that covers a sixth of the screen has stopped accenting" : "";
      console.log(`  accent load    ${r.accentPct}% of the viewport${verdict}`);
    }

    /*
     * BY COMPONENT, NOT BY INSTANCE.
     *
     * A trade tape with sixty rows reports sixty contrast failures, and the one genuinely
     * invisible label three screens down is never read. There are not sixty problems here;
     * there is one `span.n`, sixty times. The count is the useful part — it says how much
     * of the screen the single fix repairs — and the worst ratio is what you fix against.
     */
    const byComponent = (xs, key, worst) => {
      const g = new Map();
      for (const x of xs) {
        const k = x[key];
        g.set(k, g.has(k) ? worst(g.get(k), x) : x);
      }
      return [...g.entries()].map(([k, x]) => ({ ...x, k, n: xs.filter((y) => y[key] === k).length }));
    };

    if (r.touch && r.small.length) {
      const g = byComponent(r.small, "el", (a, b) => (a.hitW * a.hitH <= b.hitW * b.hitH ? a : b));
      console.log(
        `   ! tap targets ${r.small.length} reachable under 44px in ${g.length} components: ` +
          // Both numbers, because they differ for a good reason: the box is what the design
          // draws, the hit area is what a thumb gets. Seeing "24x5 -> hit 30x40" says someone
          // already worked on this and it is still short; "24x5 -> hit 24x5" says nobody has.
          list(g, (x) => `${x.k} box ${x.w}x${x.h} hit ${x.show}${x.n > 1 ? ` x${x.n}` : ""}`),
      );
    }
    if (r.lowContrast.length) {
      const g = byComponent(r.lowContrast, "el", (a, b) => (a.ratio <= b.ratio ? a : b)).sort(
        (a, b) => a.ratio - b.ratio,
      );
      console.log(
        `   ! contrast    ${r.lowContrast.length} runs in ${g.length} components (worst shown): ` +
          list(g, (x) => `${x.k} ${x.ratio}:1<${x.need}${x.n > 1 ? ` x${x.n}` : ""}`),
      );
    }
    const onPhoto = r.overMedia.filter((x) => x.kind === "photo");
    const onGrad = r.overMedia.filter((x) => x.kind === "gradient");
    if (onPhoto.length)
      console.log(
        `   ! over photo  ${onPhoto.length} text runs on a picture — contrast changes with the ` +
          `image, so only a scrim fixes it: ${list(onPhoto, (x) => x.el)}`,
      );
    if (onGrad.length)
      console.log(`   ? over gradient ${onGrad.length}: ${list(onGrad, (x) => x.el)} — worst case is computable`);
    if (r.longLines.length)
      console.log(`   ! measure     ${list(r.longLines, (x) => `${x.el} ~${x.ch}ch`)}  — over ~75ch is hard to track`);
  }

  if (motion.length) {
    console.log(`\n══ prefers-reduced-motion ═════════════════════════════`);
    for (const m of motion)
      console.log(
        `   ! ${m.route}: ${m.els.length} animation(s) still looping with motion reduced — ` +
          `${[...new Set(m.els)].slice(0, 6).join(", ")}`,
      );
  }

  console.log(
    `\nCounted evidence only. What it cannot see — whether the right thing is biggest, whether\n` +
      `a control looks like what it does, whether the page is honest about state — is in\n` +
      `references/taste.md. Open the screenshots and use it.`,
  );

  if (cli.json) await writeFile(cli.json, JSON.stringify(all, null, 2));
  return 0;
}

main().then(
  (c) => process.exit(c),
  (e) => {
    console.error(e);
    process.exit(2);
  },
);
