// The deliverable that pays for the software.
//
// A SECOND CONSUMER OF ONE RENDERER, NOT A SECOND RENDERER. This paints nothing.
// It takes the document `renderCatalogue` already produced — the same string the
// preview frame shows — and asks a browser to print it. That is the whole reason
// principle 6 exists: the predecessor grew two renderers and its preview stopped
// resembling its deliverable, which is a defect you only discover at the printer.
//
// ── THE FONTS ARE THE RISK, NOT THE BROWSER ─────────────────────────────────
//
// The preview reads correctly on a specialist's machine because THEIR machine
// has a Traditional Chinese serif. A server has none unless one was installed,
// and the failure mode is not an error: it is a PDF full of tofu boxes, produced
// successfully, at the printer's. The image installs Noto CJK and the document's
// font stack names the faces Alpine actually ships; the paint probe below is
// what turns that silent wrong answer into a loud one.
//
// ── ONE AT A TIME ───────────────────────────────────────────────────────────
//
// Chromium rendering a hundred plates is the heaviest thing this application
// does. Two at once on a 2GB machine is an out-of-memory kill, which takes the
// whole server with it and looks like a crash rather than like contention. The
// queue is four lines and it is the difference between slow and down.

import { existsSync } from "node:fs";

import puppeteer, { type Browser } from "puppeteer-core";

/** Where Chromium is. Named explicitly; nothing here downloads a browser. */
export function browserExecutable(): string | null {
  const declared = process.env.PUPPETEER_EXECUTABLE_PATH;
  if (declared && existsSync(declared)) return declared;
  for (const candidate of [
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
    "/usr/bin/google-chrome",
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export class NoBrowserError extends Error {
  constructor() {
    super(
      "No Chromium to print with. It ships in the container image; " +
        "locally, set PUPPETEER_EXECUTABLE_PATH to a Chrome or Chromium binary.",
    );
    this.name = "NoBrowserError";
  }
}

let queue: Promise<unknown> = Promise.resolve();

/** Run `job` after whatever is already printing, whether it succeeded or not. */
function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.then(job, job);
  // The queue must not inherit this job's rejection, or one failed export
  // poisons every export after it.
  queue = run.catch(() => undefined);
  return run;
}

export interface PdfResult {
  bytes: Uint8Array;
  /**
   * Whether a Chinese glyph actually PAINTED — not whether a font was named.
   *
   * False means every Chinese character in that file is a tofu box.
   */
  rendersCjk: boolean;
  /** The named faces the renderer could see, for a person reading a log. */
  fonts: string[];
}

export async function renderPdf(html: string): Promise<PdfResult> {
  const executablePath = browserExecutable();
  if (!executablePath) throw new NoBrowserError();

  return enqueue(async () => {
    let browser: Browser | undefined;
    try {
      browser = await puppeteer.launch({
        executablePath,
        // --no-sandbox because the container already is the sandbox: an
        // unprivileged process in a single-purpose image with no other tenant.
        // Chromium's own sandbox needs user namespaces that are not available
        // here, and without this it exits immediately with a message about
        // SUID helpers that reads like a build problem.
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--font-render-hinting=none",
        ],
      });
      const page = await browser.newPage();
      // `load` rather than `networkidle`: every plate is already inline, so
      // there is no network to go idle and waiting for one is waiting for a
      // timeout.
      await page.setContent(html, { waitUntil: "load", timeout: 120_000 });

      // DECODED, not merely loaded. A data: URI is "complete" before its pixels
      // exist, and printing a fraction of a second early produces a catalogue
      // of empty frames — successfully, with no error anywhere.
      await page.evaluate(async () => {
        await Promise.all(
          Array.from(document.images).map((image) =>
            image.decode().catch(() => undefined),
          ),
        );
        await document.fonts.ready;
      });

      // ── THE FONT CHECK, AND THE FIRST VERSION OF IT WAS WRONG ─────────────
      //
      // It enumerated `document.fonts`, which holds only faces declared through
      // @font-face. This document declares none and names system families
      // instead, so a machine with every Chinese font installed reported that it
      // had none. A check that cannot tell a working server from a broken one is
      // worse than no check at all: it would have been loosened the first time
      // it failed, and the real failure would then have shipped behind it.
      //
      // So this measures PAINT. The glyph 青 is drawn, and so is a private-use
      // codepoint no font on earth carries, and their pixels are compared.
      // Identical means 青 came out as the same notdef box — which is precisely
      // the failure being hunted and is invisible to every other kind of test.
      const probe = await page.evaluate(() => {
        const families = [
          "Noto Serif CJK HK",
          "Noto Serif CJK TC",
          "Noto Serif TC",
          "Source Han Serif TC",
          "Songti TC",
          "Noto Sans CJK TC",
        ];
        const named = families.filter((family) =>
          document.fonts.check(`16px "${family}"`, "青"),
        );

        const canvas = document.createElement("canvas");
        canvas.width = 80;
        canvas.height = 80;
        const context = canvas.getContext("2d");
        if (!context) return { named, rendersCjk: false };

        // The document's own stack, so this measures what the catalogue uses
        // rather than what this function happens to ask for.
        const stack = getComputedStyle(document.body).fontFamily;
        const paint = (character: string): string => {
          context.clearRect(0, 0, 80, 80);
          context.fillStyle = "#000";
          context.font = `56px ${stack}`;
          context.fillText(character, 6, 62);
          return canvas.toDataURL();
        };
        const blank = paint(" ");
        const chinese = paint("青");
        const notdef = paint(String.fromCodePoint(0x10fffd));
        return { named, rendersCjk: chinese !== notdef && chinese !== blank };
      });

      await page.emulateMediaType("print");
      const bytes = await page.pdf({
        // The document declares `@page { size: A4; margin: 0 }` and sizes its
        // own pages in millimetres, so the CSS is believed rather than
        // overridden here. Two sources of truth for the page box is how you get
        // a blank page after every real one.
        preferCSSPageSize: true,
        printBackground: true,
        timeout: 180_000,
      });

      return {
        bytes: new Uint8Array(bytes),
        rendersCjk: probe.rendersCjk,
        fonts: probe.named,
      };
    } finally {
      await browser?.close().catch(() => undefined);
    }
  });
}
