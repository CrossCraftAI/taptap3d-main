// Turning a house's record types into a form, and a form back into types.
//
// ── WHY THIS IS A MODULE AND NOT PARSING INSIDE THE ACTION ─────────────────
//
// The encoding is the whole of the risk. A record type is a nested thing —
// types, each with properties, each with options — and HTML forms are flat,
// so something has to flatten it and something has to put it back. Those two
// have to agree exactly, and the way they stop agreeing is that one of them
// lives in an action nobody tests.
//
// ── INDICES IN THE NAME, DATA IN THE VALUE ─────────────────────────────────
//
// `prop:0:1:key` carries two integers and nothing else; the column's actual
// name is the field's VALUE. That is not tidiness — a house's own column may
// be called "Estimate: HKD", and `src/app/settings/actions.ts` already
// carries a scar from exactly this: its `level:` fields have to `slice` the
// prefix rather than `split` on the colon, because only the first one belongs
// to the form. Keeping the customer's strings out of the names means this one
// has nothing to get wrong.

import {
  PROPERTY_TYPES,
  type PropertyDefinition,
  type PropertyType,
  type RecordType,
  type RecordTypes,
} from "@/lib/record-types";

/** A type's name, and a property's. Bounded so a form cannot write an essay. */
export const MAX_NAME = 120;
/** A column name. The same bound the field-policy screen uses for the same thing. */
export const MAX_KEY = 80;
/** How many options a select may offer before the list stops being a list. */
export const MAX_OPTIONS = 60;

export const TYPE_FIELD = "type:";
export const PROP_FIELD = "prop:";

/**
 * The separator a person types between a select's options.
 *
 * 、 IS THE CHINESE ENUMERATION COMMA and is what a Traditional Chinese
 * keyboard produces in a list; a comma is what a Latin one produces. Both are
 * accepted because a house will use both in the same afternoon, and refusing
 * one would be the product telling somebody their keyboard is wrong.
 */
const OPTION_SEPARATOR = /[,、\n]/;

export function splitOptions(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(OPTION_SEPARATOR)) {
    const option = part.trim();
    // DUPLICATES DROPPED RATHER THAN STORED. "A、B、A" is somebody typing, and
    // a select that offers A twice is a control that looks broken.
    if (!option || seen.has(option)) continue;
    seen.add(option);
    out.push(option);
    if (out.length >= MAX_OPTIONS) break;
  }
  return out;
}

export function joinOptions(options: readonly string[] | undefined): string {
  return (options ?? []).join("、");
}

/**
 * An id for a type the house has just named.
 *
 * ── IT IS GENERATED ONCE AND THEN NEVER CHANGES ───────────────────────────
 *
 * `lots.record_type` stores this string, so renaming 腕錶 to "Wristwatches"
 * must NOT re-slug the type — every lot of that kind would silently become
 * untyped. The form therefore carries the existing id in a hidden field and
 * this is only ever reached for a type that does not have one yet.
 *
 * ASCII-ONLY OUTPUT, with a counter fallback, because a house naming its
 * types 腕錶 and 瓷器 would otherwise get two empty slugs.
 */
export function slugFor(name: string, taken: ReadonlySet<string>): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  let id = base || "type";
  let n = 2;
  while (taken.has(id)) id = `${base || "type"}-${n++}`;
  return id;
}

/** One row of the form, as the screen draws it. */
export interface PropertyRow {
  key: string;
  zh: string;
  en: string;
  type: PropertyType;
  /** The options as a person typed them, not as an array. */
  options: string;
  required: boolean;
}

export interface TypeRow {
  /** Empty for a type the house is adding now. */
  id: string;
  zh: string;
  en: string;
  properties: PropertyRow[];
}

/** The stored types, as rows to draw. */
export function rowsOf(types: RecordTypes): TypeRow[] {
  return Object.values(types).map((type) => ({
    id: type.id,
    zh: type.name.zh,
    en: type.name.en,
    properties: type.properties.map((property) => ({
      key: property.key,
      zh: property.label.zh,
      en: property.label.en,
      type: property.type,
      options: joinOptions(property.options),
      required: property.required === true,
    })),
  }));
}

/** Everything the form sent, as `(index, field) -> value`. */
type Entries = Iterable<[string, FormDataEntryValue]>;

/**
 * Read a submitted form back into record types.
 *
 * ── TOTAL, AND IT DROPS RATHER THAN REFUSES ───────────────────────────────
 *
 * A type with no name is a row somebody added and did not fill in; a property
 * with no key is the same. Both are dropped, because the alternative is a
 * screen that refuses to save eleven good types over one empty row at the
 * bottom — which is what an "add another" button produces every time.
 *
 * What it will NOT do is silently change an id. A row that arrives with one
 * keeps it, whatever its name now says, because `lots.record_type` points at
 * it.
 */
export function typesFromForm(entries: Entries): RecordTypes {
  const types = new Map<number, { id: string; zh: string; en: string }>();
  const props = new Map<number, Map<number, Partial<PropertyRow>>>();

  for (const [name, raw] of entries) {
    if (typeof raw !== "string") continue;
    if (name.startsWith(TYPE_FIELD)) {
      const [index, field] = name.slice(TYPE_FIELD.length).split(":");
      const i = Number(index);
      if (!Number.isInteger(i) || !field) continue;
      const row = types.get(i) ?? { id: "", zh: "", en: "" };
      if (field === "id") row.id = raw.trim();
      if (field === "zh") row.zh = raw.trim().slice(0, MAX_NAME);
      if (field === "en") row.en = raw.trim().slice(0, MAX_NAME);
      types.set(i, row);
      continue;
    }
    if (!name.startsWith(PROP_FIELD)) continue;
    const [typeIndex, propIndex, field] = name.slice(PROP_FIELD.length).split(":");
    const i = Number(typeIndex);
    const j = Number(propIndex);
    if (!Number.isInteger(i) || !Number.isInteger(j) || !field) continue;
    const forType = props.get(i) ?? new Map<number, Partial<PropertyRow>>();
    const row = forType.get(j) ?? {};
    if (field === "key") row.key = raw.trim().slice(0, MAX_KEY);
    if (field === "zh") row.zh = raw.trim().slice(0, MAX_NAME);
    if (field === "en") row.en = raw.trim().slice(0, MAX_NAME);
    if (field === "kind") {
      row.type = PROPERTY_TYPES.includes(raw as PropertyType) ? (raw as PropertyType) : "text";
    }
    if (field === "options") row.options = raw;
    // AN UNCHECKED CHECKBOX SENDS NOTHING, so presence is the answer and the
    // absence of the field is how `false` arrives.
    if (field === "required") row.required = raw === "on" || raw === "true";
    forType.set(j, row);
    props.set(i, forType);
  }

  const out: Record<string, RecordType> = {};
  const taken = new Set<string>();
  for (const [i, row] of [...types.entries()].sort((a, b) => a[0] - b[0])) {
    const zh = row.zh || row.en;
    const en = row.en || row.zh;
    if (!zh) continue;
    const id = row.id || slugFor(en, taken);
    // A FORM CANNOT PRODUCE TWO TYPES WITH ONE ID, and if one somehow arrives
    // the first wins — the same resolution `recordTypesFrom` makes for a
    // duplicate property key, so the two readers cannot disagree.
    if (taken.has(id)) continue;
    taken.add(id);

    const properties: PropertyDefinition[] = [];
    const keys = new Set<string>();
    for (const [, property] of [...(props.get(i) ?? new Map()).entries()].sort(
      (a, b) => a[0] - b[0],
    )) {
      const key = property.key ?? "";
      // A carried key is never a property — `derive`'s `neverPrints` owns
      // that rule and `recordTypesFrom` keeps it on the way in too.
      if (!key || key.startsWith("_") || keys.has(key)) continue;
      keys.add(key);
      const type = property.type ?? "text";
      const options = type === "select" ? splitOptions(property.options ?? "") : [];
      properties.push({
        key,
        label: { zh: property.zh || key, en: property.en || property.zh || key },
        type,
        ...(type === "select" && options.length > 0 ? { options } : {}),
        ...(property.required ? { required: true } : {}),
      });
    }
    out[id] = { id, name: { zh, en }, properties };
  }
  return out;
}
