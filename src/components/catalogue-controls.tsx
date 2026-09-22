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
      className="flex w-full flex-wrap items-center gap-x-4 gap-y-1.5"
    >
      <label className="flex items-center gap-2 text-[13px]">
        <span className="text-muted">Template</span>
        <select
          name="template"
          value={template.id}
          onChange={(e) => chooseTemplate(e.target.value)}
          className="border border-rule bg-paper px-2 py-1 text-[13px]"
        >
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name.en} · {t.name.zh}
            </option>
          ))}
        </select>
      </label>

      <label className="flex items-center gap-2 text-[13px]">
        <span className="text-muted">Per page</span>
        <select
          name="perPage"
          value={String(local.perPage)}
          onChange={(e) => change({ perPage: Number(e.target.value) })}
          // One density is a fact about the template, not a choice to make.
          disabled={template.densities.length < 2}
          className="border border-rule bg-paper px-2 py-1 text-[13px] disabled:text-muted"
        >
          {template.densities.map((density) => (
            <option key={density} value={density}>
              {density}
            </option>
          ))}
        </select>
      </label>

      {template.placements.length > 0 && (
        <label className="flex items-center gap-2 text-[13px]">
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
            className="border border-rule bg-paper px-2 py-1 text-[13px] disabled:text-muted"
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

      <label className="flex items-center gap-2 text-[13px]">
        <span className="text-muted">Fit</span>
        <select
          name="fit"
          value={local.fit}
          onChange={(e) =>
            change({ fit: e.target.value as CatalogueParams["fit"] })
          }
          className="border border-rule bg-paper px-2 py-1 text-[13px]"
        >
          <option value="page">符合頁面 · whole page</option>
          <option value="width">符合寬度 · page width</option>
        </select>
      </label>

      <label className="flex items-center gap-2 text-[13px]">
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
        className="hidden min-w-0 flex-1 truncate text-[12px] text-faint xl:block"
        title={template.purpose}
      >
        {template.purpose}
      </p>

      {/* The no-JavaScript path. Every control above submits on change, so this
          is never needed in a browser that ran the bundle — and is the only way
          to apply a change in one that did not. */}
      <button
        type="submit"
        className="ml-auto border border-ruleStrong px-2.5 py-1 text-[12px] hover:bg-sunk"
      >
        Apply
      </button>
    </form>
  );
}
