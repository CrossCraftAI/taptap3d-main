"use client";

import { useRef, useState } from "react";

import { setCatalogueParamsAction } from "@/app/events/[id]/catalogue/actions";
import { DENSITIES, type CatalogueParams } from "@/lib/engine/derive";

/**
 * Density, placement, fit, reference.
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
  params,
}: {
  eventId: string;
  params: CatalogueParams;
}): React.ReactElement {
  const form = useRef<HTMLFormElement>(null);
  const [local, setLocal] = useState<CatalogueParams>(params);

  const submit = (): void => form.current?.requestSubmit();
  const change = (patch: Partial<CatalogueParams>): void => {
    setLocal((previous) => ({ ...previous, ...patch }));
    // After the state update is committed, so the form posts the new value
    // rather than the one being replaced.
    queueMicrotask(submit);
  };

  return (
    <form
      ref={form}
      action={setCatalogueParamsAction.bind(null, eventId)}
      className="flex flex-wrap items-center gap-x-5 gap-y-2 border border-rule bg-paper px-4 py-2.5"
    >
      <label className="flex items-center gap-2 text-[13px]">
        <span className="text-muted">Per page</span>
        <select
          name="perPage"
          value={String(local.perPage)}
          onChange={(e) => change({ perPage: Number(e.target.value) })}
          className="border border-rule bg-paper px-2 py-1 text-[13px]"
        >
          {DENSITIES.map((density) => (
            <option key={density} value={density}>
              {density}
            </option>
          ))}
        </select>
      </label>

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
          className="border border-rule bg-paper px-2 py-1 text-[13px]"
        >
          <option value="above">above the caption</option>
          <option value="beside">beside the caption</option>
        </select>
      </label>

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
          className="accent-[#a32a24]"
        />
        <span className="text-muted">Print the reference</span>
      </label>

      {/* The no-JavaScript path. Every control above submits on change, so this
          is never needed in a browser that ran the bundle — and is the only way
          to apply a change in one that did not. */}
      <button
        type="submit"
        className="ml-auto border border-ruleStrong px-2.5 py-1 text-[12px] hover:bg-field"
      >
        Apply
      </button>
    </form>
  );
}
