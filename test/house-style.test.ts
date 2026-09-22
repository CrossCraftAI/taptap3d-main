// The two things about the interface that are a CLOSED SET, held as a census.
//
// Neither of these can be caught by reading a diff. A type scale grows one
// near-miss at a time — 13px and 14px, three months and two people apart, and
// nobody who reads either commit can see the other — and an accent leaks out of
// its token the same way, one `hover:bg-[#8d241f]` at a time, until changing
// the house colour is thirteen edits in nine files instead of one.
//
// So both are counted over the source, the way golden.test.ts counts the
// colours in a rendered document, and both fail by NAMING what is new rather
// than by pointing at a line.
//
// ── WHAT THIS DOES NOT COVER, AND WHY ───────────────────────────────────────
//
// src/lib/render/html.ts. That is the PRINT stylesheet: its greys and its type
// are the paper's, not the screen's, it is emitted into a document with no
// access to any of these tokens, and it has a census of its own in
// golden.test.ts that asserts a closed set of sixteen house greys. Retheming
// the application must not reach a catalogue that has already been printed,
// and the fact that this file cannot see that one is how that stays true.

import { readFileSync } from "node:fs";
import { globSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..");

/** Every component and page, which is everything that carries a class name. */
const SOURCES = globSync("src/**/*.{ts,tsx}", { cwd: ROOT })
  .map((file) => file.replaceAll("\\", "/"))
  .sort();

const read = (file: string): string => readFileSync(path.join(ROOT, file), "utf8");

/**
 * Files another agent owns this cycle, with the exact thing each still
 * carries.
 *
 * NOT A SUPPRESSION LIST. Each entry asserts that the file STILL has the
 * problem, so the moment its owner fixes it this test goes red and says to
 * delete the entry — which is the only kind of exception that does not
 * outlive its reason. An entry that is merely a name would be a hole somebody
 * widens next month.
 *
 * IT IS EMPTY, AND THE MECHANISM IS WHY. Three tranches were built in parallel
 * worktrees and none could touch another's files, so this list held what the
 * scale and the token sweep could not reach: two `text-[11px]` in the shell's
 * rail, and two seal buttons on the editor's header still carrying a raw hex.
 * They are the whole of what fell between the three, and they were found by a
 * taste scan reporting SIX sizes on a page whose source had five — because a
 * census over class names cannot see a file its author did not own. The
 * entries went red when the files were fixed, exactly as designed, and were
 * deleted. Add one only for a file another cycle genuinely owns, and delete
 * it the day it goes red.
 */
const NOT_OURS: { file: string; carries: string; why: string }[] = [];

const EXCUSED = new Set(NOT_OURS.map((e) => e.file));

describe("the exceptions are still needed", () => {
  it("has none outstanding", () => {
    // An empty list is the goal state, and saying so out loud is what stops
    // the next person reading the empty array as "this check is off".
    expect(NOT_OURS).toEqual([]);
  });

  it.each(NOT_OURS.map((e) => [e.file, e] as const))("%s", (file, entry) => {
    expect(SOURCES, `${file} is gone; delete its entry`).toContain(file);
    expect(
      read(file).includes(entry.carries),
      `${file} no longer carries ${entry.carries} (${entry.why}) — delete its entry from NOT_OURS`,
    ).toBe(true);
  });
});

// ── The type scale ──────────────────────────────────────────────────────────

/**
 * Five sizes, and that is the whole scale.
 *
 *   10  small caps, column headers, tags, counts
 *   12  the workhorse — hints, buttons, chips, captions, secondary lines
 *   13  body base — nav, inputs, prose, table cells
 *   15  section headings
 *   16  a page's title, and the largest type on any screen
 *
 * It was EIGHT, measured: 10, 11, 12, 13, 14, 15, 18 and 19. The 11s were
 * column headers and counts in one place and hints in another — two tiers
 * wearing one number — and 14 against 13 is not a scale, it is two people and
 * two dates. What a reader gets from five is that a size MEANS something:
 * 12 is always the quiet line under the loud one.
 */
const SCALE = [10, 12, 13, 15, 16];

/**
 * Tailwind's own named sizes, which are a second scale in disguise: `text-lg`
 * is 18px and looked like a heading, so two empty states were 18 while every
 * other page title was 19. Named sizes are refused outright rather than mapped
 * — the scale above is in pixels, and a name that resolves to a pixel value
 * somewhere else is exactly how the eighth size got in.
 */
const NAMED = /\btext-(xs|sm|base|lg|xl|[2-9]xl)\b/g;

describe("the type scale is five sizes", () => {
  it("and the application uses those five and nothing else", () => {
    const found = new Map<number, string[]>();
    for (const file of SOURCES) {
      if (EXCUSED.has(file)) continue;
      for (const [, px] of read(file).matchAll(/text-\[([0-9.]+)px\]/g)) {
        const size = Number(px);
        found.set(size, [...(found.get(size) ?? []), file]);
      }
    }
    const sizes = [...found.keys()].sort((a, b) => a - b);
    // The failure names the size and where it came in, because "expected
    // [10,12,13,14,15,16] to equal [10,12,13,15,16]" sends the reader hunting.
    const offScale = sizes
      .filter((s) => !SCALE.includes(s))
      .map((s) => `${s}px in ${[...new Set(found.get(s))].join(", ")}`);
    expect(offScale).toEqual([]);
    expect(sizes).toEqual(SCALE);
  });

  it("and no named size, which would be a second scale", () => {
    const hits = SOURCES.filter((f) => !EXCUSED.has(f)).flatMap((file) =>
      [...read(file).matchAll(NAMED)].map((m) => `${file}: ${m[0]}`),
    );
    expect(hits).toEqual([]);
  });
});

// ── The accent ──────────────────────────────────────────────────────────────

/**
 * Every colour a component names goes through a token.
 *
 * THE HOUSE COLOUR IS NOT CHOSEN. `--color-seal` in globals.css is a
 * placeholder and the owner will pick one, so the only thing worth holding is
 * that picking it is ONE EDIT. A hex in a class name is a copy of the decision
 * that will not move when the decision does — and they arrive as hover states,
 * because there is no token for "the same colour, pressed" until somebody
 * makes one. There is now: `--color-sealPress`, derived from `--color-seal`.
 *
 * Scoped to the class names components write, not to globals.css, which is
 * where the values are SUPPOSED to be — that file is the one edit.
 *
 * AND NOT TO COMMENTS, which is not a loophole but the point. This repository
 * records the number it measured beside the decision it drove — "`--color-faint`
 * is #9a9a9a on #ffffff, which is 2.8:1" is the evidence for a choice — and a
 * census that forbade that would teach people to delete the evidence and keep
 * the choice. A hex in prose paints nothing. A hex in a class name paints
 * something and will not move when the token moves; that is the whole
 * distinction. So the comments come out before the search, rather than a whole
 * file being excused for having explained itself.
 */
const HEX = /#[0-9a-fA-F]{3,8}\b/g;

/** The file with its comments removed, so prose is not mistaken for paint. */
const code = (file: string): string =>
  read(file)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");

it("no component names a colour the theme does not", () => {
  const hits = SOURCES.filter(
    (f) => !EXCUSED.has(f) && (f.startsWith("src/app/") || f.startsWith("src/components/")),
  ).flatMap((file) =>
    [...code(file).matchAll(HEX)].map((m) => `${file}: ${m[0]}`),
  );
  expect(hits).toEqual([]);
});

it("still catches a hex in a class name, comments or no comments", () => {
  // THE CONTROL. Stripping comments is how a census stops crying wolf, and it
  // is also how one quietly stops working — the strip is one regex away from
  // eating the file. So the stripper is asked, here, whether it can still see
  // the thing it exists to find, with the two comment forms around it.
  const sample = [
    "// a note about #123456",
    "/* and #abcdef, over",
    "   two lines */",
    'const a = "hover:bg-[#8d241f]";',
  ].join("\n");
  const stripped = sample
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
  expect([...stripped.matchAll(HEX)].map((m) => m[0])).toEqual(["#8d241f"]);
});
