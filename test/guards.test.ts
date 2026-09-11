// Structural guards: rules from ARCHITECTURE.md that a test can actually hold.
//
// These read the repository rather than exercising code, which is the right
// shape for a rule about how the repository is configured. A comment stating a
// rule is a wish; a test stating it is a rule.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (p: string): string => readFileSync(path.join(ROOT, p), "utf8");

/** Files git is actually tracking, which is the only list that matters here. */
function trackedFiles(): string[] {
  return execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" })
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

describe("type checking cannot be quietly relaxed", () => {
  // Read as text rather than imported: tsconfig.json permits comments, and
  // Next rewrites this file on build, so the assertion has to survive both.
  const tsconfig = read("tsconfig.json");

  it.each([
    ["strict", true],
    ["noUncheckedIndexedAccess", true],
    ["noImplicitOverride", true],
    ["noFallthroughCasesInSwitch", true],
  ])("%s is enabled", (flag, value) => {
    expect(tsconfig).toMatch(new RegExp(`"${flag}"\\s*:\\s*${value}`));
  });
});

describe("client material is never committed", () => {
  it("git actually reports tracked files — a zero-match walk proves nothing", () => {
    // Without this, every "leaked is empty" assertion below passes trivially the
    // moment `git ls-files` returns nothing: wrong cwd, no git, a detached
    // checkout. The predecessor learned this on a source walk that silently
    // matched zero files and reported success for weeks.
    //
    // Anchored to a file that must always be tracked rather than to a count:
    // a size floor is a number someone has to keep correct, and the first
    // version of this line failed simply because the repository was four files
    // old.
    expect(trackedFiles()).toContain("README.md");
  });

  // ARCHITECTURE.md and DFD.md both state this: the sample catalogues are other
  // people's copyrighted work and the lot files are other people's data. The
  // predecessor kept them on disk and gitignored; the rule survives the move
  // only if something enforces it.
  const ignore = read(".gitignore");

  it.each(["samples/", ".env", ".data/"])("%s is gitignored", (entry) => {
    expect(ignore).toContain(entry);
  });

  it("no tracked file lives under samples/ or .data/", () => {
    const leaked = trackedFiles().filter(
      (f) => f.startsWith("samples/") || f.startsWith(".data/"),
    );
    expect(leaked).toEqual([]);
  });

  it("no tracked file is a catalogue PDF or a client spreadsheet", () => {
    const leaked = trackedFiles().filter((f) =>
      /\.(pdf|xlsx|xls|docx)$/i.test(f),
    );
    expect(leaked).toEqual([]);
  });

  it("no .env file is tracked", () => {
    // .env.example is the documentation and is meant to be here; anything else
    // called .env carries a real credential.
    const leaked = trackedFiles().filter(
      (f) => path.basename(f).startsWith(".env") && f !== ".env.example",
    );
    expect(leaked).toEqual([]);
  });
});

describe("the founding documents are present", () => {
  // They are the spine referenced by every other decision. A repository that
  // loses them keeps the rules and loses the reasons.
  it.each(["DFD.md", "ARCHITECTURE.md", "ROADMAP.md", "README.md"])(
    "%s exists and is not a stub",
    (doc) => {
      expect(read(doc).length).toBeGreaterThan(1000);
    },
  );
});
