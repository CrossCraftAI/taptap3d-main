// Which built capabilities can a person actually reach?
//
// ── THE QUESTION THIS ANSWERS, AND WHY IT IS ASKED MECHANICALLY ────────────
//
// The revision this product is in started from an audit that found "23 editor
// capabilities in the codebase and unreachable by a person" and eight stored
// override keys with no control. That audit was done by hand, once. This does
// it in a second, so the number can be asked again after every phase rather
// than rediscovered when somebody wonders.
//
// ── IT DISTINGUISHES THREE THINGS, AND THE MIDDLE ONE IS THE TRAP ──────────
//
//   DEAD      declared, and called by nothing anywhere in src — not even by
//             the module it lives in. Exported for a test, or left behind.
//   via-lib   called by another library module but never named under app/ or
//             components/. Reachable, as long as its caller is.
//   (silent)  named in the UI. Nothing to report.
//
// The trap is a helper that is exported only so a test can see it and USED by
// the file it lives in: `getCatalogue` came out as dead on the first run, an
// hour after it was wired into a screen, because the count of its own file's
// occurrences was compared the wrong way. A declaration scores 1 in its own
// file; a declaration with a caller scores 2 or more, and that is the whole
// distinction.
//
//   node scripts/census.mjs
//
// Every DEAD line is a question, not a defect: several are deferred on purpose
// with the reason written where the code is. What it catches is the ones that
// are not.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
const walk = (dir, out = []) => {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(p)) out.push(p);
  }
  return out;
};

const libFiles = walk(join(root, "src", "lib"));
const uiFiles = [
  ...walk(join(root, "src", "app")),
  ...walk(join(root, "src", "components")),
];
const allSrc = walk(join(root, "src"));
const testFiles = walk(join(root, "test"));

const uiText = uiFiles.map((f) => readFileSync(f, "utf8")).join("\n");
const srcText = allSrc.map((f) => readFileSync(f, "utf8")).join("\n");
const testText = testFiles.map((f) => readFileSync(f, "utf8")).join("\n");

const EXPORT = /^export\s+(?:async\s+)?function\s+([A-Za-z0-9_]+)/gm;
const rows = [];
for (const f of libFiles) {
  const rel = relative(root, f).split("\\").join("/");
  const text = readFileSync(f, "utf8");
  for (const m of text.matchAll(EXPORT)) {
    const name = m[1];
    const uses = (s) => new RegExp(`\\b${name}\\b`, "g").exec(s) !== null;
    // "used by the UI" = named anywhere under app/ or components/
    const inUi = uses(uiText);
    // "used anywhere in src outside its own file"
    const own = (text.match(new RegExp(`\\b${name}\\b`, "g")) || []).length;
    const everywhere = (srcText.match(new RegExp(`\\b${name}\\b`, "g")) || []).length;
    // `own` counts the declaration too, so a helper CALLED inside its own
    // file scores 2 or more. That distinction is the whole point: a function
    // exported only so a test can reach it, but used by the module it lives
    // in, is reachable — its file is. Only a declaration with no caller
    // anywhere is an orphan.
    const usedInOwnFile = own > 1;
    const elsewhere = everywhere - own > 0;
    const tested = uses(testText);
    if (!inUi && !usedInOwnFile) rows.push({ name, file: rel, elsewhere, tested });
  }
}
rows.sort((a, b) => Number(a.elsewhere) - Number(b.elsewhere) || a.file.localeCompare(b.file));
const orphans = rows.filter((r) => !r.elsewhere);
console.log(`exports in src/lib not named anywhere under app/ or components/: ${rows.length}`);
console.log(`of those, not named anywhere else in src either: ${orphans.length}\n`);
for (const r of orphans) console.log(`  DEAD  ${r.file}  ${r.name}${r.tested ? "  (tested)" : "  (untested)"}`);
console.log("\n— reached only through another lib module —");
for (const r of rows.filter((r) => r.elsewhere).slice(0, 40)) console.log(`  via-lib  ${r.file}  ${r.name}`);
