"use client";

import { useActionState } from "react";

import { LEVEL_WORDS, Reach } from "@/app/events/[id]/lots/[lotId]/reach";
import { AUDIENCES } from "@/lib/engine/visibility";
import { logAction } from "@/lib/log/client";
import { IDLE_POLICY_FORM, type PolicyFormState, type PolicyRow, type PolicyView } from "@/lib/settings";

import { setFieldPolicyAction } from "./actions";

/**
 * Which of the house's fields may leave the building.
 *
 * ── THE SAME BADGE AND THE SAME THREE WORDS AS THE LOT RECORD ───────────────
 *
 * `Reach` and `LEVEL_WORDS` are imported from the lot record rather than
 * redrawn here, the way src/components/lot-fields-form.tsx already imports
 * them. Three screens now say where a value goes — the record's field rows,
 * its "Where this prints" box, and this — and the one thing they must not do
 * is say it three ways. The words are this system's names for a rule it
 * enforces (not the house's nouns, which the vocabulary layer will relabel),
 * so one definition is the correct number.
 *
 * ── UNCONTROLLED SELECTS, RESET BY REMOUNT ──────────────────────────────────
 *
 * The same arrangement as the lot record's fields form and for the same
 * reason: nothing submits on change, there is one Save, and what the DOM holds
 * at that moment is what the person wants written. Authority returns to the
 * server by REMOUNTING the body on a version the page derives from the org's
 * own `updated_at`, so after a save every default is the stored answer —
 * including the new field that has just joined the list and the one that was
 * returned to public and is therefore no longer in the map.
 *
 * The status line lives outside the remounted body, or it would be cleared in
 * the same instant it had something to say.
 *
 * ── NOTHING DISABLES ITSELF WHILE SAVING ────────────────────────────────────
 *
 * Only the submit button does. A disabled input is blurred by the browser and
 * eats what is typed into it — the predecessor lost `-1.37` to exactly that —
 * and the field name box here is the one a person is most likely to still be
 * typing into when a previous save lands.
 */
export function FieldPolicyForm({
  view,
  version,
}: {
  view: PolicyView;
  /** The org's own `updated_at`, so a save remounts the body. */
  version: number;
}): React.ReactElement {
  const [state, action, pending] = useActionState<PolicyFormState, FormData>(
    setFieldPolicyAction,
    IDLE_POLICY_FORM,
  );

  return (
    <form
      action={action}
      onSubmit={() => logAction("settings.field-policy.save", { marked: view.marked })}
      className="mt-3 border border-rule bg-paper"
    >
      <Body key={version} view={view} />

      <div className="flex items-center justify-between gap-4 border-t border-rule bg-field px-4 py-2.5">
        <p
          key={state.at}
          role="status"
          aria-live="polite"
          className={`min-w-0 text-[12px] ${state.ok ? "text-muted" : "text-seal"}`}
        >
          {state.message}
        </p>
        <button
          type="submit"
          disabled={pending}
          className="min-h-[var(--tap)] shrink-0 bg-seal px-3 text-[13px] font-medium text-white hover:bg-sealPress disabled:opacity-60"
        >
          Save the policy
        </button>
      </div>
    </form>
  );
}

function Body({ view }: { view: PolicyView }): React.ReactElement {
  return (
    <div>
      <Section
        name="The fields this system names"
        note={
          "Nine columns an import is matched onto. They are listed whether or " +
          "not any lot carries one yet, so a field can be marked before the " +
          "spreadsheet that fills it arrives."
        }
        rows={view.core}
      />
      {view.house.length > 0 && (
        <Section
          name="The house's own columns"
          note={
            "Read from the records themselves — there is no list of these " +
            "anywhere else, because the field set belongs to the house. Most " +
            "used first."
          }
          rows={view.house}
        />
      )}
      <NameOne />
    </div>
  );
}

function Section({
  name,
  note,
  rows,
}: {
  name: string;
  note: string;
  rows: PolicyRow[];
}): React.ReactElement {
  return (
    <section>
      <div className="border-b border-rule bg-field px-4 py-2">
        <h3 className="text-[10px] font-semibold uppercase tracking-[0.09em] text-muted">
          {name}
        </h3>
        <p className="mt-0.5 max-w-prose text-[12px] leading-relaxed text-faint">
          {note}
        </p>
      </div>
      {rows.map((row) => (
        <Row key={row.key} row={row} />
      ))}
    </section>
  );
}

function Row({ row }: { row: PolicyRow }): React.ReactElement {
  const id = `level-${row.key}`;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-rule px-4 py-2">
      <div className="min-w-0 flex-1">
        <label htmlFor={id} className="block truncate text-[13px]">
          {row.label}
        </label>
        <span className="block truncate text-[12px] text-faint">{row.hint}</span>
      </div>

      {/* WHAT IT COSTS TO HIDE THIS ONE. A house deciding whether a column may
          print wants to know how much of its own record the decision touches,
          and it is the number this screen already had to read in order to know
          the column exists at all. Nought is a real answer — a core field
          nobody has imported yet, or a field marked and since emptied. */}
      <span className="w-24 shrink-0 text-right text-[12px] text-faint" data-numeric>
        {row.lots === 0 ? "no lots" : `${row.lots} ${row.lots === 1 ? "lot" : "lots"}`}
      </span>

      {/* The badge the lot record shows beside this field, here beside the
          control that sets it, so the two screens are legibly the same fact.
          Absent at `public`, which is most rows of most houses. */}
      <Reach level={row.level} />

      <select
        id={id}
        name={`level:${row.key}`}
        defaultValue={row.level}
        className="min-h-[var(--tap)] w-32 shrink-0 border border-rule bg-paper px-1.5 text-[13px]"
      >
        {AUDIENCES.map((audience) => (
          <option key={audience} value={audience} title={LEVEL_WORDS[audience].means}>
            {LEVEL_WORDS[audience].name}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * A field nobody has named yet.
 *
 * TWO PLAIN INPUTS, not an "add row" button that grows the form — the same
 * shape and the same reason as the lot record's new column: the path without
 * JavaScript has to be able to add one too.
 *
 * `public` IS NOT AN OPTION HERE, and the omission is the point. Naming a
 * field in order to declare it public is a no-op — it is public already — so
 * offering it would be a control whose only outcome is nothing happening. The
 * action refuses it in words rather than silently, for the reader who types
 * the URL.
 */
function NameOne(): React.ReactElement {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 bg-field px-4 py-2.5">
      <div className="min-w-0 flex-1">
        <label htmlFor="newKey" className="block text-[13px]">
          A field that has not arrived yet
        </label>
        <span className="block max-w-prose text-[12px] leading-relaxed text-faint">
          Name a column the next import will bring — 保留價, say — and it is
          held back from the first derivation rather than from the second.
        </span>
      </div>
      <input
        id="newKey"
        name="newKey"
        placeholder="the column's name, exactly as it will arrive"
        className="min-h-[var(--tap)] w-64 max-w-full border border-rule bg-paper px-2 text-[13px] placeholder:text-faint"
      />
      <select
        name="newLevel"
        aria-label="Which readership may have it"
        defaultValue=""
        className="min-h-[var(--tap)] w-32 shrink-0 border border-rule bg-paper px-1.5 text-[13px]"
      >
        <option value="">how far…</option>
        {AUDIENCES.filter((audience) => audience !== "public").map((audience) => (
          <option key={audience} value={audience} title={LEVEL_WORDS[audience].means}>
            {LEVEL_WORDS[audience].name}
          </option>
        ))}
      </select>
    </div>
  );
}
