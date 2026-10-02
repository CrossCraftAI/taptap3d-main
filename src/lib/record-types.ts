// A house's own schema for its own records.
//
// ── WHAT THIS BUYS THAT `lots.fields` DOES NOT ─────────────────────────────
//
// `lots.fields` is open jsonb and the field set belongs to the customer, which
// is right and is not changing. What it cannot express is anything ABOUT a
// field: that 品相 is one of four grades rather than free prose, that a watch
// without a calibre is a mistake, that 直徑 is a number.
//
// The model is Notion's, which the owner named: a database is a schema of
// typed PROPERTIES, and a select's options live in the property definition
// rather than in the rows. Three things follow, and all three are things this
// product could not say before:
//
//   a property can be VALIDATED at entry, so a missing calibre is caught
//   rather than printed blank;
//   a property can be ENUMERATED, so "condition: A / B / C" is a closed set a
//   person picks from rather than a string they retype four ways;
//   adding a property MIGRATES NOTHING, because absent means empty, which is
//   exactly how `lots.fields` already behaves.
//
// ── THE TYPE GOVERNS INPUT AND NEVER OUTPUT ────────────────────────────────
//
// Values stay STRINGS in `lots.fields`. A typed value still renders as a
// string, `asText` is untouched, `derive` is untouched, and the print path
// learns no second vocabulary. That is the whole reason this can be added to
// a database full of existing records without a backfill: a column that was
// free text yesterday and is a `select` today is still the same bytes, and a
// value that does not match the new rule is REPORTED where somebody can fix
// it rather than refused on read.
//
// ── THE THREE TYPES, AND WHY THERE IS NO `date` ────────────────────────────
//
// Notion has text, number, date, select, multi-select, checkbox and URL. The
// set below is the subset this domain can honestly enforce, and the omission
// that matters is `date`.
//
// A DATE IN THIS TRADE IS NOT A CALENDAR DATE. `CORE_FIELDS` already says so
// at the field itself — "Period, dynasty or year — text, not a calendar date"
// — because the values are 清乾隆, 民國, "circa 1860", "18th century". A date
// type that demanded something parseable would reject the correct value for
// almost every Chinese antique in the first sale it met, and the first thing
// a house would do is stop using types at all.
//
// `number` IS HERE AND IS NOT FOR THE ESTIMATE. An auction estimate is a
// RANGE — "800,000 – 1,200,000 HKD", which `CORE_FIELDS` also states — so the
// core `price` field must never be typed as a number. It is for the house's
// own measured columns: a calibre, a diameter, a weight.
//
// ── AND WHAT IS DELIBERATELY NOT TAKEN FROM NOTION ─────────────────────────
//
// Relations and rollups need a second kind of record to point at, which is
// the thing this creates; they are the sequel. Formulas are an expression
// language, a product of their own, and this product already has an engine
// that computes. A database per kind of thing would cost every existing
// query, index and `org_id` guarantee — and Notion's own storage is one table
// too; the database is a view over it.

import { normaliseHeader } from "@/lib/import/fields";

/**
 * What a property may be.
 *
 * NAMED, NOT NUMBERED, for the reason `AUDIENCES` gives one file away: a
 * person reading `select` in a jsonb column knows what it means, and the
 * first thing that happens to a numeric scale is that somebody inserts a
 * value in the middle and every stored row means something else.
 */
export const PROPERTY_TYPES = ["text", "number", "select"] as const;
export type PropertyType = (typeof PROPERTY_TYPES)[number];

export interface PropertyDefinition {
  /** The key in `lots.fields`. The customer's own column name. */
  key: string;
  /** Bilingual, because the first customers work in Traditional Chinese. */
  label: { zh: string; en: string };
  type: PropertyType;
  /**
   * The closed set, for `select` and meaningless for anything else.
   *
   * IN THE DEFINITION AND NOT IN THE ROWS, which is the half of Notion's
   * model that does the work: the options are the house's answer, so adding
   * one is a change in one place rather than a migration over every lot.
   */
  options?: readonly string[];
  /**
   * Whether a lot of this type must carry it.
   *
   * SEPARATE FROM THE TYPE, because "a watch with no calibre is a mistake" is
   * a statement about PRESENCE and has nothing to do with whether the value
   * is a number. Folding it into the type would mean a `required-number` and
   * a `number`, and then the same for every other type.
   */
  required?: boolean;
}

export interface RecordType {
  /** Stable, and what `lots.record_type` stores. */
  id: string;
  name: { zh: string; en: string };
  properties: readonly PropertyDefinition[];
}

/** Every record type a house has defined, by id. Empty for every house today. */
export type RecordTypes = Readonly<Record<string, RecordType>>;

export const NO_RECORD_TYPES: RecordTypes = {};

export type Verdict =
  | { ok: true }
  /** One sentence, in the second person, naming what to do about it. */
  | { ok: false; reason: string };

/**
 * Whether one value satisfies one property.
 *
 * ── EMPTY IS THE CASE TO GET RIGHT ─────────────────────────────────────────
 *
 * An empty value is FINE unless the property is required. That is not
 * leniency: `lots.fields` drops a key whose value is blank (the lot form's
 * own rule), and every record written before a type existed is missing most
 * of what a type now names. Treating absence as a failure would light up a
 * house's entire back catalogue the moment they defined their first type.
 */
export function check(property: PropertyDefinition, raw: string): Verdict {
  const value = raw.trim();
  if (value === "") {
    return property.required
      ? { ok: false, reason: `${property.label.zh} is needed on every lot of this kind.` }
      : { ok: true };
  }

  if (property.type === "number") {
    // ── WHAT COUNTS AS A NUMBER IN A HOUSE'S SPREADSHEET ───────────────────
    //
    // "42", "42.5", "1,200", "42 mm", "約 42" are all a person writing a
    // measurement. Demanding a bare numeral would reject the commonest real
    // values and teach a house that types are a nuisance — so this asks the
    // one question the type exists for: is there a number in here at all.
    // What it catches is "see condition report" in a column of calibres,
    // which is the mistake worth catching.
    if (!/\d/.test(value)) {
      return {
        ok: false,
        reason: `${property.label.zh} should be a measurement, and this has no number in it.`,
      };
    }
    return { ok: true };
  }

  if (property.type === "select") {
    const options = property.options ?? [];
    // A `select` with no options constrains nothing. Refusing every value
    // would be the product punishing a half-finished definition.
    if (options.length === 0) return { ok: true };
    // MATCHED THE WAY THE IMPORTER MATCHES HEADERS, so "Grade A", "grade a"
    // and "GRADE　A" are one option rather than three — the same
    // `normaliseHeader` and not a second normaliser, for the reason that
    // file gives: two that drift is a bug presenting as "matching got worse".
    const wanted = normaliseHeader(value);
    if (options.some((option) => normaliseHeader(option) === wanted)) return { ok: true };
    return {
      ok: false,
      reason: `${property.label.zh} is one of: ${options.join("、")}.`,
    };
  }

  return { ok: true };
}

/**
 * Every complaint a lot's values would raise against its type.
 *
 * REPORTS, NEVER REFUSES — ARCHITECTURE.md principle 9. A record that does
 * not satisfy its type is a record somebody needs to look at, not a record
 * the product should decline to store: the values may have arrived from a
 * client's spreadsheet an hour before a sale, and a save that refuses is a
 * save that loses the other eleven fields somebody just typed.
 */
export function complaints(
  type: RecordType,
  fields: Readonly<Record<string, unknown>>,
): { key: string; reason: string }[] {
  const out: { key: string; reason: string }[] = [];
  for (const property of type.properties) {
    const raw = fields[property.key];
    const verdict = check(property, typeof raw === "string" ? raw : "");
    if (!verdict.ok) out.push({ key: property.key, reason: verdict.reason });
  }
  return out;
}

/**
 * Whatever `orgs.record_types` holds, as record types.
 *
 * TOTAL, and it drops what it cannot read rather than failing — `templateFor`
 * and `faceFor`'s rule. The column is jsonb a screen will one day write, and
 * a house whose definition is half-saved must still be able to open a lot.
 */
export function recordTypesFrom(raw: unknown): RecordTypes {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return NO_RECORD_TYPES;
  const out: Record<string, RecordType> = {};
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    const type = readType(id, value);
    if (type) out[id] = type;
  }
  return out;
}

function readType(id: string, raw: unknown): RecordType | null {
  if (typeof raw !== "object" || raw === null) return null;
  const source = raw as Record<string, unknown>;
  const name = readLabel(source.name);
  if (!name) return null;
  const properties: PropertyDefinition[] = [];
  for (const entry of Array.isArray(source.properties) ? source.properties : []) {
    const property = readProperty(entry);
    // NO DUPLICATE KEYS. Two definitions of one column is two answers to what
    // it is, and the later one would win silently on whichever side iterated
    // last.
    if (property && !properties.some((p) => p.key === property.key)) properties.push(property);
  }
  return { id, name, properties };
}

function readLabel(raw: unknown): { zh: string; en: string } | null {
  if (typeof raw !== "object" || raw === null) return null;
  const source = raw as Record<string, unknown>;
  const zh = typeof source.zh === "string" ? source.zh.trim() : "";
  const en = typeof source.en === "string" ? source.en.trim() : "";
  if (!zh && !en) return null;
  // A label with one half is honest; a label with neither is not a label.
  return { zh: zh || en, en: en || zh };
}

function readProperty(raw: unknown): PropertyDefinition | null {
  if (typeof raw !== "object" || raw === null) return null;
  const source = raw as Record<string, unknown>;
  const key = typeof source.key === "string" ? source.key.trim() : "";
  if (!key) return null;
  // A CARRIED KEY IS NOT A PROPERTY. `_`-prefixed keys are the predecessor's
  // bookkeeping and never print (derive.ts, `neverPrints`); typing one would
  // be a rule about a value nobody can see.
  if (key.startsWith("_")) return null;
  const label = readLabel(source.label) ?? { zh: key, en: key };
  const type = PROPERTY_TYPES.includes(source.type as PropertyType)
    ? (source.type as PropertyType)
    : "text";
  const options = Array.isArray(source.options)
    ? source.options.filter((o): o is string => typeof o === "string" && o.trim() !== "")
    : undefined;
  return {
    key,
    label,
    type,
    ...(type === "select" && options ? { options } : {}),
    ...(source.required === true ? { required: true } : {}),
  };
}

/** The type a lot is of, or null when it has none — which is every lot today. */
export function recordTypeOf(types: RecordTypes, id: string | null): RecordType | null {
  if (!id) return null;
  return types[id] ?? null;
}
