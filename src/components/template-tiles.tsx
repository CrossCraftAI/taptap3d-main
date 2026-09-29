"use client";

import type { TemplateTile } from "@/lib/render/template-preview";

/**
 * Choose a template by looking at what it does.
 *
 * ── THE ENGINE DREW THESE, AND IT HAD BEEN ABLE TO ALL ALONG ───────────────
 *
 * `src/lib/render/template-preview.ts` has been complete and tested since
 * Phase 2: `templateTiles` derives a real document from the sale's own opening
 * lots, once per template, and returns the page as fractions. Nothing called
 * it. The picker was a `<select>` of three names, so choosing a layout meant
 * choosing it, looking at the result, and choosing again — which is a preview
 * with extra steps, on the one control where the answer is a picture.
 *
 * The census in scripts/census.mjs is what found it: an export reachable from
 * nothing, with a header explaining a decision nobody could see.
 *
 * ── SMALL, BECAUSE THE COLUMN IS 230 PIXELS ────────────────────────────────
 *
 * Docked beside the page the settings column is 230px wide, so three tiles
 * side by side get about 64 each. That is enough: a page proxy answers "four
 * in a grid" against "a row per lot" against "one to a sheet" at a glance, and
 * it is the ONLY question this control is asked. Detail beyond the
 * arrangement would be a smaller, worse copy of the preview two inches away.
 *
 * ── RADIOS, SO THE FORM STILL WORKS WITHOUT JAVASCRIPT ─────────────────────
 *
 * The `<select>` this replaces carried `name="template"` and the surrounding
 * form posts it; a group of radios with that same name is the same submission.
 * The visible tile is a sibling of a screen-reader-only input, which keeps the
 * keyboard behaviour the browser already gives a radio group — arrow keys move
 * between templates — rather than rebuilding it on divs.
 */
export function TemplateTiles({
  tiles,
  current,
  onPick,
}: {
  tiles: readonly TemplateTile[];
  current: string;
  onPick: (id: string) => void;
}): React.ReactElement {
  return (
    <fieldset className="min-w-0">
      <legend className="mb-1 text-[13px] text-muted">Template</legend>
      <div className="flex flex-wrap gap-1.5">
        {tiles.map((tile) => {
          const picked = tile.id === current;
          return (
            <label
              key={tile.id}
              // THE FLOOR IS DECLARED EVEN THOUGH THE TILE EXCEEDS IT. A
              // 64×90 proxy is well past `--tap` in both axes, so the token
              // changes nothing here — but test/house-style.test.ts reads
              // CLASS NAMES, not rendered boxes, and "a tick's floor belongs
              // to its label" is the rule this label has to satisfy in the
              // one way the census can see. Cheaper than weakening a check
              // that has caught real controls.
              className="group block min-h-[var(--tap)] min-w-0 cursor-pointer"
              title={`${tile.name.en} · ${tile.name.zh} — ${tile.purpose}`}
            >
              <input
                type="radio"
                name="template"
                value={tile.id}
                checked={picked}
                onChange={() => onPick(tile.id)}
                className="sr-only peer"
              />
              <Proxy tile={tile} picked={picked} />
              <span
                className={`mt-1 block truncate text-[10px] ${
                  picked ? "font-medium text-ink" : "text-muted"
                }`}
              >
                {tile.name.en}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/**
 * One sheet, at the shape of the paper, with the engine's own boxes on it.
 *
 * ── AN EMPTY TILE IS A REAL ANSWER ─────────────────────────────────────────
 *
 * `blocks` is empty for a sale with no lots, and for a template the engine
 * refused for this one. The tile is still pickable and still shows the paper,
 * because "this template lays out nothing here" is a thing worth seeing and a
 * missing tile would read as a missing template.
 */
function Proxy({
  tile,
  picked,
}: {
  tile: TemplateTile;
  picked: boolean;
}): React.ReactElement {
  return (
    <span
      // `--sunk` is the desk the editor's own canvas uses, so a tile reads as
      // a little sheet on the same surface as the big one.
      className={`relative block w-16 overflow-hidden border bg-paper transition-shadow ${
        picked
          ? "border-ink shadow-[0_0_0_1px_var(--color-ink)]"
          : "border-rule group-hover:border-ruleStrong"
      }`}
      style={{ aspectRatio: String(tile.aspect) }}
      aria-hidden="true"
    >
      {tile.blocks.map((block, i) => (
        <span
          key={i}
          className={`absolute ${
            // A plate is the solid one and the caption is the hairline: the
            // difference a person is choosing between is where the PICTURE
            // goes, so the picture is what the eye should find first.
            block.kind === "plate" ? "bg-ruleStrong" : "bg-rule"
          }`}
          style={{
            left: `${block.x * 100}%`,
            top: `${block.y * 100}%`,
            width: `${block.w * 100}%`,
            height: `${Math.max(block.h * 100, 1)}%`,
          }}
        />
      ))}
    </span>
  );
}
