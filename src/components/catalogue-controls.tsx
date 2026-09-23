"use client";

import { useRef, useState } from "react";

import { setCatalogueParamsAction } from "@/app/events/[id]/catalogue/actions";
import type { CatalogueParams } from "@/lib/engine/derive";
import type { TemplateChoice } from "@/lib/engine/templates";
import { logAction } from "@/lib/log/client";

/**
 * Template, density, placement, fit, reference.
 *
 * ── THE TEMPLATE IS THE FIRST CONTROL, AND THE OTHERS READ IT ───────────────
 *
 * Density and placement are not the engine's vocabulary any more; they are the
 * chosen template's (src/lib/engine/templates.ts). So the density select offers
 * what THIS template offers — five grids for a catalogue, three row counts for
 * a price list, one for a tearsheet — and the placement select offers where
 * this template's plate may go, or nothing when it has no plate. A control
 * that offered nine-up on a price list would be offering a number the engine
 * would silently replace, which is the one thing principle 9 forbids.
 *
 * Choosing a template posts that template's own defaults for the rest, so the
 * form is coherent in the same request. The server resolves everything against
 * the template again, so a stale value cannot land whatever the bundle did.
 *
 * ── CONTROLLED, AND THE SERVER IS THE SOURCE OF TRUTH ───────────────────────
 *
 * These were uncontrolled inputs with `defaultValue`, and that was a real bug
 * rather than a style question. The form submits EVERY field together, so once
 * the DOM's idea of the density had drifted from the server's, the next change
 * to any other control posted the stale value back: set 9-up, change the fit,
 * and the density silently reverted to 4 while the preview redrew as though the
 * specialist had asked for it. React does not push a changed `defaultValue`
 * into an input a person has already touched, so nothing resynchronised it.
 *
 * Found by driving the application and reading the screenshot — the unit suite
 * could not have seen it, and neither could a person who changed one control at
 * a time.
 *
 * Local state exists only so the control responds in the same frame the pointer
 * moves. Authority returns to the server by REMOUNTING: the parent keys this
 * component on the stored parameters, so when the action lands the component is
 * new and `useState` reads the server's answer as its initial value. That is the
 * React-idiomatic reset, and it is why there is no effect here syncing a prop
 * into state — which is both a lint error and the slower of the two paths.
 *
 * ── EVERY CONTROL CARRIES `--tap`, AND THAT IS THE TOKEN AND NOT A NUMBER ────
 *
 * `--tap` (globals.css) is 28px with a precise pointer and 44px under
 * `@media (pointer: coarse)`, because a condition check happens on a tablet in
 * a warehouse, one-handed (DFD.md §1). The ledger's tabs, search and pager have
 * read it since they were written; this form did not, so the screen a
 * specialist spends the day on was the one screen where nothing was reachable.
 * The fix is the ledger's, not a second convention: `min-h-[var(--tap)]`
 * replaces the vertical padding, so the box IS the token rather than a number
 * that happens to agree with it today.
 *
 * WHAT IT COSTS THE PAGE, AND WHY THAT IS ACCEPTABLE HERE. Docked at `lg` and
 * above this is a COLUMN, so a taller control takes column height and none of
 * the canvas — the sheet is height-bound, and this strip is beside it rather
 * than above it (catalogue-workspace.tsx does that arithmetic). Below `lg` it
 * is a strip across the top and a taller control does cost the sheet; that is
 * the coarse-pointer case, which is the case the token exists for.
 */
export function CatalogueControls({
  eventId,
  catalogueId,
  params,
  templates,
}: {
  eventId: string;
  /** Null on a blank editor: the row is made by the first change (catalogue/actions.ts). */
  catalogueId: string | null;
  params: CatalogueParams;
  templates: TemplateChoice[];
}): React.ReactElement {
  const form = useRef<HTMLFormElement>(null);
  const [local, setLocal] = useState<CatalogueParams>(params);
  const template =
    templates.find((t) => t.id === local.template) ?? templates[0]!;

  const submit = (): void => form.current?.requestSubmit();
  const change = (patch: Partial<CatalogueParams>): void => {
    setLocal((previous) => ({ ...previous, ...patch }));
    // Counted: a density or template change is a gesture D9 has to weigh
    // against the corrections it causes or saves.
    logAction("catalogue.params", patch, catalogueId);
    // After the state update is committed, so the form posts the new value
    // rather than the one being replaced.
    queueMicrotask(submit);
  };
  const chooseTemplate = (id: string): void => {
    const next = templates.find((t) => t.id === id);
    if (!next) return;
    change({
      template: next.id,
      perPage: next.defaultPerPage,
      imagePlacement: next.placements.includes(local.imagePlacement)
        ? local.imagePlacement
        : (next.placements[0] ?? local.imagePlacement),
    });
  };

  return (
    <form
      ref={form}
      action={setCatalogueParamsAction.bind(null, eventId)}
      // No border or ground of its own: this is one row of the editor's toolbar
      // (catalogue-workspace.tsx), which draws the rules. The bar it used to be
      // cost the page 60px of the window's height.
      // TWO SHAPES, ONE FORM. Docked beside the page at `lg` and above it is a
      // column 230px wide; below that there is no desk to dock to and it is a
      // strip across the top (src/components/catalogue-workspace.tsx explains
      // which and why). Same fields, same submit, same one stored object —
      // only the axis changes, so there is nothing to keep in step.
      className="flex w-full flex-wrap items-center gap-x-4 gap-y-1.5 lg:flex-col lg:items-stretch lg:gap-y-2.5"
    >
      <label className="flex items-center gap-2 text-[13px] lg:flex-col lg:items-start lg:gap-1">
        <span className="text-muted">Template</span>
        <select
          name="template"
          value={template.id}
          onChange={(e) => chooseTemplate(e.target.value)}
          className="min-h-[var(--tap)] border border-rule bg-paper px-2 text-[13px] lg:w-full"
        >
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name.en} · {t.name.zh}
            </option>
          ))}
        </select>
      </label>

      <label className="flex items-center gap-2 text-[13px] lg:flex-col lg:items-start lg:gap-1">
        <span className="text-muted">Per page</span>
        <select
          name="perPage"
          value={String(local.perPage)}
          onChange={(e) => change({ perPage: Number(e.target.value) })}
          // One density is a fact about the template, not a choice to make.
          disabled={template.densities.length < 2}
          className="min-h-[var(--tap)] border border-rule bg-paper px-2 text-[13px] disabled:text-muted lg:w-full"
        >
          {template.densities.map((density) => (
            <option key={density} value={density}>
              {density}
            </option>
          ))}
        </select>
      </label>

      {template.placements.length > 0 && (
        <label className="flex items-center gap-2 text-[13px] lg:flex-col lg:items-start lg:gap-1">
          <span className="text-muted">Photograph</span>
          <select
            name="imagePlacement"
            value={local.imagePlacement}
            onChange={(e) =>
              change({
                imagePlacement: e.target.value as CatalogueParams["imagePlacement"],
              })
            }
            disabled={template.placements.length < 2}
            className="min-h-[var(--tap)] border border-rule bg-paper px-2 text-[13px] disabled:text-muted lg:w-full"
          >
            {template.placements.includes("above") && (
              <option value="above">above the caption</option>
            )}
            {template.placements.includes("beside") && (
              <option value="beside">
                {template.arrangement === "table" ? "beside each row" : "beside the caption"}
              </option>
            )}
          </select>
        </label>
      )}

      <label className="flex items-center gap-2 text-[13px] lg:flex-col lg:items-start lg:gap-1">
        <span className="text-muted">Fit</span>
        <select
          name="fit"
          value={local.fit}
          onChange={(e) =>
            change({ fit: e.target.value as CatalogueParams["fit"] })
          }
          className="min-h-[var(--tap)] border border-rule bg-paper px-2 text-[13px] lg:w-full"
        >
          <option value="page">符合頁面 · whole page</option>
          <option value="width">符合寬度 · page width</option>
        </select>
      </label>

      {/* THE TARGET IS THE LABEL, NOT THE BOX. A checkbox is 13×13 by the
          browser's own stylesheet and there is no honest way to make that
          square 44px — a tick the size of a button reads as a button, and
          beside four selects it would be the loudest thing in the column. The
          floor goes on the `<label>`, which already wraps the words, so the
          whole line "Print the reference" is what a finger presses. */}
      <label className="flex min-h-[var(--tap)] items-center gap-2 text-[13px]">
        <input
          type="checkbox"
          name="showRef"
          checked={local.showRef}
          onChange={(e) => change({ showRef: e.target.checked })}
          className="accent-seal"
        />
        <span className="text-muted">Print the reference</span>
      </label>

      {/* What the chosen template is FOR, in the template's own words, so the
          choice is made on purpose rather than by trying each.

          IT GOES RATHER THAN TRUNCATES, below the width where it can be read.
          Measured on the editor at 1280: forty pixels of a three-hundred-and-
          ninety-nine-pixel sentence were showing, which is four or five
          characters and an ellipsis — present, unreadable, and taking the room
          the controls beside it wanted. A label that cannot be read is not a
          smaller label. The `title` carries it at every width, and the same
          sentence is on each option of the Template select. */}
      <p
        className="hidden min-w-0 flex-1 truncate text-[12px] text-faint xl:block lg:block lg:flex-none lg:overflow-visible lg:whitespace-normal lg:leading-relaxed"
        title={template.purpose}
      >
        {template.purpose}
      </p>

      {/* The no-JavaScript path. Every control above submits on change, so this
          is never needed in a browser that ran the bundle — and is the only way
          to apply a change in one that did not. */}
      <button
        type="submit"
        className="ml-auto min-h-[var(--tap)] border border-ruleStrong px-2.5 text-[12px] hover:bg-sunk lg:ml-0 lg:w-full"
      >
        Apply
      </button>
    </form>
  );
}
