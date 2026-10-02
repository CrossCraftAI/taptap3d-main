"use client";

import { useActionState, useState } from "react";

import { logAction } from "@/lib/log/client";
import {
  MAX_KEY,
  MAX_NAME,
  PROP_FIELD,
  TYPE_FIELD,
  type PropertyRow,
  type TypeRow,
} from "@/lib/record-type-form";
import { PROPERTY_TYPES, type PropertyType } from "@/lib/record-types";
import { IDLE_POLICY_FORM, type PolicyFormState } from "@/lib/settings";

import { setRecordTypesAction } from "./actions";

/**
 * Where a house says what kinds of thing it sells, and what it knows about
 * each.
 *
 * ── THE SHAPE IS NOTION'S AND THE RESTRAINT IS THE POINT ───────────────────
 *
 * A kind is a name and a list of typed properties over the columns a house
 * already imports. It does not create a new table, it does not change what
 * prints, and it cannot make an existing record unreadable — the type governs
 * INPUT only (src/lib/record-types.ts).
 *
 * ── WHY EVERY ROW POSTS ON EVERY SUBMIT ────────────────────────────────────
 *
 * `setRecordTypes` replaces rather than merges, which is what makes deleting
 * a kind expressible from the only screen that can delete one. So removing a
 * row here is removing it from the next submit, and there is no "delete"
 * round trip to get wrong.
 *
 * ── AND WHY DELETING A KIND IS SAFE TO OFFER ───────────────────────────────
 *
 * `lots.record_type` is text and not a foreign key, deliberately: lots that
 * name a deleted kind read as untyped and keep every value they had. A house
 * changing its mind about its schema does not lose its records, which is what
 * makes this a screen somebody can experiment on.
 */

const TAP = "min-h-[var(--tap)]";
const INPUT = `${TAP} w-full border border-rule bg-paper px-2 text-[13px]`;

const EMPTY_PROPERTY: PropertyRow = {
  key: "",
  zh: "",
  en: "",
  type: "text",
  options: "",
  required: false,
};

/** What each type means, on the control itself rather than in a paragraph. */
const TYPE_NOTE: Readonly<Record<PropertyType, string>> = {
  text: "Anything. What every column is today.",
  number:
    "A measurement — a calibre, a diameter. NOT an estimate: an estimate is a range.",
  select: "One of a list you name. A closed set, so nobody retypes it four ways.",
};

export function RecordTypesForm({
  initial,
}: {
  initial: TypeRow[];
}): React.ReactElement {
  const [state, action, pending] = useActionState<PolicyFormState, FormData>(
    setRecordTypesAction,
    IDLE_POLICY_FORM,
  );
  const [rows, setRows] = useState<TypeRow[]>(initial);

  const edit = (i: number, patch: Partial<TypeRow>): void =>
    setRows((current) => current.map((row, n) => (n === i ? { ...row, ...patch } : row)));

  const editProperty = (i: number, j: number, patch: Partial<PropertyRow>): void =>
    setRows((current) =>
      current.map((row, n) =>
        n === i
          ? {
              ...row,
              properties: row.properties.map((p, m) => (m === j ? { ...p, ...patch } : p)),
            }
          : row,
      ),
    );

  return (
    <form action={action} onSubmit={() => logAction("settings.recordTypes", {})}>
      {rows.length === 0 ? (
        <p className="mt-3 border border-rule bg-field px-4 py-3 text-[13px] leading-relaxed text-muted">
          {/* SAYS WHAT ONE IS FOR, not that there are none. A house reading
              "no kinds defined" learns nothing about whether they want any. */}
          No kinds defined, and every lot is of no particular kind — which is
          how this product has always worked. Name one when a column needs an
          answer the spreadsheet cannot give: a condition grade that is one of
          four, a calibre that must not be blank.
        </p>
      ) : (
        <ol className="m-0 mt-3 list-none space-y-4 p-0">
          {rows.map((row, i) => (
            <li key={row.id || `new-${i}`} className="border border-rule bg-paper">
              <input type="hidden" name={`${TYPE_FIELD}${i}:id`} value={row.id} />
              <div className="flex flex-wrap items-end gap-3 border-b border-rule bg-field px-4 py-2">
                <label className="text-[12px] text-muted">
                  <span className="block">中文名稱</span>
                  <input
                    name={`${TYPE_FIELD}${i}:zh`}
                    value={row.zh}
                    maxLength={MAX_NAME}
                    onChange={(e) => edit(i, { zh: e.target.value })}
                    className={`${INPUT} mt-1 w-40`}
                  />
                </label>
                <label className="text-[12px] text-muted">
                  <span className="block">In English</span>
                  <input
                    name={`${TYPE_FIELD}${i}:en`}
                    value={row.en}
                    maxLength={MAX_NAME}
                    onChange={(e) => edit(i, { en: e.target.value })}
                    className={`${INPUT} mt-1 w-40`}
                  />
                </label>
                <button
                  type="button"
                  onClick={() => setRows((c) => c.filter((_, n) => n !== i))}
                  className={`${TAP} ml-auto inline-flex items-center px-2 text-[12px] text-muted hover:text-seal`}
                >
                  Remove this kind
                </button>
              </div>

              <table className="w-full table-fixed border-collapse text-[13px]">
                <thead>
                  <tr className="border-b border-rule text-left text-[10px] tracking-wide text-muted">
                    <th className="w-40 px-3 py-2 font-medium">Column</th>
                    <th className="w-36 px-3 py-2 font-medium">名稱</th>
                    <th className="w-32 px-3 py-2 font-medium">Is</th>
                    <th className="px-3 py-2 font-medium">One of</th>
                    <th className="w-24 px-3 py-2 font-medium">Needed</th>
                    <th className="w-10 px-2 py-2 font-medium">
                      <span className="sr-only">Remove</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {row.properties.map((property, j) => (
                    <tr key={j} className="border-b border-rule last:border-b-0">
                      <td className="px-3 py-1.5">
                        <label className="sr-only" htmlFor={`k-${i}-${j}`}>
                          Column name
                        </label>
                        <input
                          id={`k-${i}-${j}`}
                          name={`${PROP_FIELD}${i}:${j}:key`}
                          value={property.key}
                          maxLength={MAX_KEY}
                          placeholder="exactly as it imports"
                          onChange={(e) => editProperty(i, j, { key: e.target.value })}
                          className={INPUT}
                        />
                      </td>
                      <td className="px-3 py-1.5">
                        <label className="sr-only" htmlFor={`z-${i}-${j}`}>
                          Label in Chinese
                        </label>
                        <input
                          id={`z-${i}-${j}`}
                          name={`${PROP_FIELD}${i}:${j}:zh`}
                          value={property.zh}
                          maxLength={MAX_NAME}
                          onChange={(e) => editProperty(i, j, { zh: e.target.value })}
                          className={INPUT}
                        />
                        <input
                          type="hidden"
                          name={`${PROP_FIELD}${i}:${j}:en`}
                          value={property.en}
                        />
                      </td>
                      <td className="px-3 py-1.5">
                        <label className="sr-only" htmlFor={`t-${i}-${j}`}>
                          What this column is
                        </label>
                        <select
                          id={`t-${i}-${j}`}
                          name={`${PROP_FIELD}${i}:${j}:kind`}
                          value={property.type}
                          title={TYPE_NOTE[property.type]}
                          onChange={(e) =>
                            editProperty(i, j, { type: e.target.value as PropertyType })
                          }
                          className={INPUT}
                        >
                          {PROPERTY_TYPES.map((type) => (
                            <option key={type} value={type}>
                              {type}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-1.5">
                        <label className="sr-only" htmlFor={`o-${i}-${j}`}>
                          The options for this column
                        </label>
                        <input
                          id={`o-${i}-${j}`}
                          name={`${PROP_FIELD}${i}:${j}:options`}
                          value={property.options}
                          // DISABLED RATHER THAN HIDDEN, so the row does not
                          // change shape as somebody changes the type beside
                          // it — and so the words they already typed are
                          // still there if they change it back.
                          disabled={property.type !== "select"}
                          placeholder={property.type === "select" ? "A、B、C" : "—"}
                          onChange={(e) => editProperty(i, j, { options: e.target.value })}
                          className={`${INPUT} disabled:bg-field disabled:text-faint`}
                        />
                      </td>
                      <td className="px-3 py-1.5">
                        <label className={`flex ${TAP} items-center gap-2 text-[12px]`}>
                          <input
                            type="checkbox"
                            name={`${PROP_FIELD}${i}:${j}:required`}
                            checked={property.required}
                            onChange={(e) =>
                              editProperty(i, j, { required: e.target.checked })
                            }
                            className="accent-seal"
                          />
                          <span className="text-muted">on every lot</span>
                        </label>
                      </td>
                      <td className="px-2 py-1.5">
                        <button
                          type="button"
                          aria-label={`Remove ${property.key || "this column"}`}
                          onClick={() =>
                            edit(i, {
                              properties: row.properties.filter((_, m) => m !== j),
                            })
                          }
                          className={`flex ${TAP} w-full items-center justify-center text-faint hover:text-seal`}
                        >
                          <span aria-hidden="true">×</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="border-t border-rule bg-field px-4 py-2">
                <button
                  type="button"
                  onClick={() =>
                    edit(i, { properties: [...row.properties, { ...EMPTY_PROPERTY }] })
                  }
                  className={`${TAP} inline-flex items-center px-2 text-[12px] text-muted hover:text-ink`}
                >
                  Add a column
                </button>
              </div>
            </li>
          ))}
        </ol>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() =>
            setRows((c) => [...c, { id: "", zh: "", en: "", properties: [{ ...EMPTY_PROPERTY }] }])
          }
          className={`${TAP} inline-flex items-center border border-ruleStrong bg-paper px-3 text-[13px] font-medium hover:bg-sunk`}
        >
          Add a kind
        </button>
        <button
          type="submit"
          disabled={pending}
          className={`${TAP} inline-flex items-center bg-seal px-4 text-[13px] font-medium text-white hover:bg-sealPress disabled:opacity-60`}
        >
          Save kinds
        </button>
        <p
          key={state.at}
          role="status"
          aria-live="polite"
          className={`min-w-0 text-[12px] ${state.ok ? "text-muted" : "text-seal"}`}
        >
          {state.message}
        </p>
      </div>
    </form>
  );
}
