// The three things about the interface that are a CLOSED SET, held as a census.
//
// None of these can be caught by reading a diff. A type scale grows one
// near-miss at a time — 13px and 14px, three months and two people apart, and
// nobody who reads either commit can see the other — an accent leaks out of
// its token the same way, one `hover:bg-[#8d241f]` at a time, until changing
// the house colour is thirteen edits in nine files instead of one, and a
// smallest-target rule is obeyed by whichever screen its author happened to be
// looking at.
//
// So all three are counted over the source, the way golden.test.ts counts the
// colours in a rendered document, and all three fail by NAMING what is new
// rather than by pointing at a line.
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

import ts from "typescript";
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

// ── The smallest a control may be ───────────────────────────────────────────

/**
 * Every pressable thing carries `--tap`, and nothing carries a copy of it.
 *
 * `--tap` (globals.css) is 28px, and 44px under `@media (pointer: coarse)`,
 * because a condition check happens on a tablet in a warehouse, one-handed.
 * The ledger's tabs, search, quick-add and pager read it and always have. The
 * EDITOR did not, and that is the failure this census exists for: a token is
 * only a house rule if the house cannot half-obey it, and nothing in a diff
 * shows you the screen that was not touched. Measured before this landed:
 * nineteen pressable elements across the editor's five components with no
 * floor at all — four selects, three checkboxes, seven text inputs and five
 * buttons — which on a sixteen-lot sale is forty reachable controls under the
 * token on one screen. Re-measure by deleting a `min-h-[var(--tap)]` and
 * reading what this test prints.
 *
 * ── WHAT COUNTS AS CARRYING IT ──────────────────────────────────────────────
 *
 * The token, never the number. `min-h-[44px]` is the same defect as a raw hex:
 * a copy of a decision that will not move when the decision does. So the
 * search is for the literal `var(--tap)` and a hard-coded pixel floor does not
 * satisfy it — which is why `src/components/lot-steps.tsx`, whose stepper is
 * `min-h-[30px]`, is on the list below rather than absolved by it.
 *
 * A CHECKBOX IS EXCUSED BY ITS LABEL AND BY NOTHING ELSE. The browser paints a
 * 13×13 square and there is no honest way to make that square 44px — a tick
 * the size of a button reads as a button. The target is the `<label>`, so the
 * floor is looked for on an enclosing `<label>` and not on any ancestor: a
 * floor on the ROW would be a target that swallows whatever else the row holds
 * (pin-panel.tsx has a link in every row and says what that costs).
 *
 * ── WHAT IT CANNOT SEE ──────────────────────────────────────────────────────
 *
 * It reads class names, so it cannot tell a 44px box from a 44px box that is
 * behind something else, cannot see a control the CSS has already made large
 * enough by other means, and cannot see whether two targets overlap. A
 * measured floor in a real browser under an emulated coarse pointer is
 * test/e2e/tap.spec.ts; this is the cheap half that runs on every commit.
 *
 * It also cannot tell an inline link in a sentence from a link that is a
 * control, and an inline link genuinely should not carry a 44px box. There is
 * no such link in a file with a zero below; if one is added, the honest answer
 * is to wrap it or to argue the exception here in prose, not to widen the
 * test.
 */
const PRESSABLE = new Set(["input", "select", "textarea", "button", "summary", "a", "Link"]);

interface Pressable {
  file: string;
  line: number;
  /** `<select>`, `<input type=checkbox>` — what a failure has to print. */
  what: string;
  floored: boolean;
}

/**
 * Every pressable element in one file, and whether it has a floor.
 *
 * PARSED, NOT MATCHED. The other two censuses here are regexes over text and
 * that is right for them: a size and a colour are their own class name. A tap
 * floor is not — a checkbox's is on an ancestor, and half the class names in
 * this repository are built from a `const box = "..."` a few lines up
 * (ledger.tsx's pager, stage.tsx's chip). A regex sees neither, and a census
 * that silently answers "fine" is worse than no census. TypeScript is already
 * a dependency and already parses TSX; the compiler's own tree gives both the
 * ancestry and the constants for nothing.
 */
function pressables(file: string, text: string): Pressable[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

  // Class-name constants, from anywhere in the file: the ones that matter are
  // declared inside the component function, not at the top.
  const consts = new Map<string, string>();
  const collect = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const init = node.initializer;
      if (
        ts.isStringLiteralLike(init) ||
        ts.isTemplateExpression(init) ||
        ts.isConditionalExpression(init)
      ) {
        consts.set(node.name.text, init.getText(sf));
      }
    }
    ts.forEachChild(node, collect);
  };
  collect(sf);
  // Three passes, because one constant is routinely built from another.
  const expand = (value: string): string => {
    let out = value;
    for (let pass = 0; pass < 3; pass++) {
      for (const [name, text_] of consts) {
        out = out.replaceAll(new RegExp(`\\b${name}\\b`, "g"), text_);
      }
    }
    return out;
  };

  const found: Pressable[] = [];
  const stack: { tag: string; floored: boolean }[] = [];
  const visit = (node: ts.Node): void => {
    const element = ts.isJsxElement(node)
      ? node.openingElement
      : ts.isJsxSelfClosingElement(node)
        ? node
        : null;
    if (element) {
      const tag = element.tagName.getText(sf);
      const attribute = (name: string): string | null => {
        for (const property of element.attributes.properties) {
          if (!ts.isJsxAttribute(property) || property.name.getText(sf) !== name) continue;
          const init = property.initializer;
          if (!init) return "";
          return ts.isStringLiteral(init) ? init.text : init.getText(sf);
        }
        return null;
      };
      const className = expand(attribute("className") ?? "");
      const floored = className.includes("var(--tap)");
      stack.push({ tag, floored });

      if (PRESSABLE.has(tag)) {
        const type = attribute("type") ?? (tag === "input" ? "text" : null);
        if (type !== "hidden") {
          const tick = type === "checkbox" || type === "radio";
          // A tick's floor belongs to its label. Nothing else counts — see the
          // header on why an ancestor row is the wrong answer.
          // Nearest first, so a label inside a label answers for the tick it
          // actually wraps. (`findLast` would say this in one line and the
          // tsconfig's lib does not carry it.)
          const label = stack
            .slice(0, -1)
            .reverse()
            .find((frame) => frame.tag === "label");
          found.push({
            file,
            line: sf.getLineAndCharacterOfPosition(element.getStart(sf)).line + 1,
            what: `<${tag}${type === null ? "" : ` type=${type}`}>`,
            floored: floored || (tick && label?.floored === true),
          });
        }
      }
    }
    ts.forEachChild(node, visit);
    if (element) stack.pop();
  };
  visit(sf);
  return found;
}

const TSX = SOURCES.filter((file) => file.endsWith(".tsx"));

const floorless = (): Pressable[] =>
  TSX.filter((file) => !EXCUSED.has(file)).flatMap((file) =>
    pressables(file, read(file)).filter((element) => !element.floored),
  );

/**
 * The screens whose controls are held to the token, named rather than inferred.
 *
 * These are the two the token was argued for: the editor a specialist is in
 * all day, and the lot form behind it. The rest of the estate is not excused —
 * it is COUNTED, below.
 */
const HELD = [
  "src/components/catalogue-controls.tsx",
  "src/components/catalogue-workspace.tsx",
  "src/components/pin-panel.tsx",
  "src/components/lot-catalogue-form.tsx",
  "src/components/lot-fields-form.tsx",
];

/**
 * Everything else, with the exact number each file still owes.
 *
 * SAME SHAPE AS `NOT_OURS` ABOVE AND FOR THE SAME REASON: a count asserts the
 * problem is still there, so fixing one entry turns this red and says to change
 * the number or delete the line. A bare list of excused file names would be a
 * hole that widens — a file could trade one small control for another and stay
 * green, and a new small control in an excused file would cost nothing.
 *
 * Both directions fail, which is the point. Going up means somebody shipped a
 * control under the floor. Going down means somebody fixed one and this record
 * is stale.
 */
const OWED: Record<string, number> = {
  "src/app/events/[id]/catalogue/page.tsx": 1,
  "src/app/events/[id]/import/page.tsx": 1,
  "src/app/events/[id]/lots/[lotId]/page.tsx": 1,
  "src/app/events/[id]/page.tsx": 5,
  "src/app/photographs/page.tsx": 1,
  "src/components/dropzone.tsx": 2,
  "src/components/import-flow.tsx": 7,
  "src/components/ledger.tsx": 4,
  "src/components/lot-photographs.tsx": 2,
  "src/components/nav.tsx": 2,
  "src/components/palette.tsx": 5,
  "src/components/photograph-library.tsx": 4,
  "src/components/shell.tsx": 1,
  "src/components/stage-control.tsx": 2,
  "src/components/switcher.tsx": 2,
};

describe("a control is never smaller than --tap", () => {
  it("on the editor and the lot form, which is what the token was argued for", () => {
    const small = floorless()
      .filter((element) => HELD.includes(element.file))
      .map((element) => `${element.file}:${element.line} ${element.what}`);
    expect(small).toEqual([]);
  });

  it("and everywhere else is counted, not excused", () => {
    const counts: Record<string, number> = {};
    for (const element of floorless()) {
      if (HELD.includes(element.file)) continue;
      counts[element.file] = (counts[element.file] ?? 0) + 1;
    }
    // Sorted, so the diff on a failure is the one file that moved rather than
    // a reordered object.
    const sort = (record: Record<string, number>): Record<string, number> =>
      Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)));
    expect(sort(counts)).toEqual(sort(OWED));
  });

  it("and a hard-coded pixel floor does not count as carrying the token", () => {
    // THE CONTROL, the same way the hex census keeps one. This census answers
    // a boolean per element and a boolean that has quietly become `true` for
    // everything looks exactly like a clean codebase. So it is shown four
    // elements whose answers are known and asked to tell them apart: padding
    // alone is not a floor, a pixel copy of the token is not the token, the
    // token is, and a tick is carried by its label and by nothing else.
    const sample = [
      "export function S(): React.ReactElement {",
      '  const box = "min-h-[var(--tap)] px-3";',
      "  return (",
      "    <div>",
      '      <button className="px-3 py-1">padding is not a floor</button>',
      '      <button className="min-h-[44px] px-3">a copy of the token</button>',
      "      <button className={box}>the token, through a constant</button>",
      '      <div className="min-h-[var(--tap)]">',
      '        <input type="checkbox" />',
      "      </div>",
      '      <label className="min-h-[var(--tap)]">',
      '        <input type="checkbox" /> ticked',
      "      </label>",
      "    </div>",
      "  );",
      "}",
    ].join("\n");
    expect(
      pressables("sample.tsx", sample).map((e) => `${e.what} ${e.floored ? "floored" : "small"}`),
    ).toEqual([
      "<button> small",
      "<button> small",
      "<button> floored",
      // A floor on the row is not a floor on the tick: it would be a target
      // over whatever else the row holds.
      "<input type=checkbox> small",
      "<input type=checkbox> floored",
    ]);
  });
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
