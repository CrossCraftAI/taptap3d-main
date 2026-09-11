// Suggest which column is which field, and say why.
//
// This is the HubSpot-shaped step: the machine proposes a mapping, a human
// clears it. Two rules follow from that and shape everything below.
//
//   IT PROPOSES, IT DOES NOT DECIDE. Nothing here writes a lot. A wrong
//   suggestion costs one click; a missing one costs a person reading forty
//   columns. So it suggests generously and is honest about confidence.
//
//   EVERY SUGGESTION CARRIES ITS REASON. "Matched the header 拍品編號" and
//   "every value looks like P01, P02" are different kinds of evidence, and a
//   specialist deciding whether to trust a suggestion needs to know which one
//   they are looking at. A confidence number alone is not an explanation.

import {
  CORE_FIELDS,
  normaliseHeader,
  type CoreFieldKey,
} from "./fields";

export interface ColumnSuggestion {
  /** Index into the table's headers. */
  column: number;
  header: string;
  /** Null means "we have no idea" — which is a legitimate answer. */
  suggested: CoreFieldKey | null;
  /** 0–1. Above 0.8 is a header match; below 0.5 is a shape guess. */
  confidence: number;
  /** Shown to the person clearing the mapping, in their language of work. */
  reason: string;
  /** Up to three alternatives, so the UI can offer them without re-deriving. */
  alternatives: CoreFieldKey[];
}

interface Candidate {
  field: CoreFieldKey;
  confidence: number;
  reason: string;
}

const IMAGE_EXTENSION = /\.(jpe?g|png|tiff?|webp|heic|gif|bmp)$/i;
const RANGE_DASH = /[–—~-]/;
const CURRENCY = /(hkd|usd|rmb|cny|gbp|eur|twd|jpy|\$|£|€|¥|港幣|人民幣|元)/i;
const DIMENSION = /\d\s*[x×✕*]\s*\d/;
const UNIT = /(cm|mm|公分|厘米|釐米|公釐|吋|inch|in\b)/i;
const YEARISH = /\b(1[0-9]{3}|20[0-9]{2})\b/;
const DYNASTY = /(明|清|宋|元|唐|漢|民國|世紀|century|dynasty|circa|c\.)/i;
const REFISH = /^[A-Za-z]{0,4}[-\s]?\d{1,5}[A-Za-z]?$/;

/** Share of non-empty samples satisfying a predicate. */
function share(values: string[], predicate: (v: string) => boolean): number {
  const present = values.filter((v) => v.trim() !== "");
  if (present.length === 0) return 0;
  return present.filter(predicate).length / present.length;
}

/**
 * What the HEADER says. The strongest signal by a wide margin: a house that
 * writes 拍品編號 means it, and no amount of value-shape cleverness beats being
 * told.
 */
function fromHeader(header: string): Candidate | null {
  const normalised = normaliseHeader(header);
  if (!normalised) return null;

  for (const field of CORE_FIELDS) {
    if (field.aliases.some((a) => normaliseHeader(a) === normalised)) {
      return {
        field: field.key,
        confidence: 0.95,
        reason: `Header “${header}” is a known name for ${field.label.en}`,
      };
    }
  }
  // Containment, not fuzzy distance: "Estimate (HKD)" contains "estimate", and
  // edit distance on CJK headers produces confident nonsense.
  for (const field of CORE_FIELDS) {
    const hit = field.aliases.find((a) => {
      const alias = normaliseHeader(a);
      return alias.length >= 2 && normalised.includes(alias);
    });
    if (hit) {
      return {
        field: field.key,
        confidence: 0.75,
        reason: `Header “${header}” contains “${hit}”`,
      };
    }
  }
  return null;
}

/**
 * What the VALUES look like. Weaker than a header and used when the header is
 * absent, blank or unrecognised — which is the case this whole screen exists
 * for.
 */
function fromValues(values: string[], uniqueRatio: number): Candidate[] {
  const found: Candidate[] = [];
  const add = (field: CoreFieldKey, confidence: number, reason: string) => {
    if (confidence > 0.3) found.push({ field, confidence, reason });
  };

  const images = share(values, (v) => IMAGE_EXTENSION.test(v.trim()));
  if (images > 0.5) {
    add("images", 0.5 + images * 0.35, `${Math.round(images * 100)}% of values are image filenames`);
  }

  const dims = share(values, (v) => DIMENSION.test(v) || (UNIT.test(v) && /\d/.test(v)));
  if (dims > 0.5) {
    add("dimensions", 0.4 + dims * 0.35, `${Math.round(dims * 100)}% of values look like measurements`);
  }

  const money = share(
    values,
    (v) => /\d/.test(v) && (CURRENCY.test(v) || /\d{1,3}(,\d{3})+/.test(v) || (RANGE_DASH.test(v) && /\d.*[–—~-].*\d/.test(v))),
  );
  if (money > 0.5) {
    add("price", 0.4 + money * 0.35, `${Math.round(money * 100)}% of values look like prices or ranges`);
  }

  const dated = share(values, (v) => YEARISH.test(v) || DYNASTY.test(v));
  if (dated > 0.6) {
    add("date", 0.35 + dated * 0.3, `${Math.round(dated * 100)}% of values name a year or a period`);
  }

  // A reference is short, shaped like P01, and nearly unique — the uniqueness is
  // what separates it from a material or a category, which are also short.
  const refShaped = share(values, (v) => REFISH.test(v.trim()));
  if (refShaped > 0.7 && uniqueRatio > 0.9) {
    add("ref", 0.4 + refShaped * 0.3, `Values are short, distinct identifiers (${Math.round(uniqueRatio * 100)}% unique)`);
  }

  // The longest free text in a sheet is the catalogue note far more often than
  // it is anything else.
  const averageLength =
    values.filter((v) => v.trim()).reduce((n, v) => n + v.length, 0) /
    Math.max(1, values.filter((v) => v.trim()).length);
  if (averageLength > 60) {
    add("description", 0.4, `Values average ${Math.round(averageLength)} characters — long free text`);
  }

  return found.sort((a, b) => b.confidence - a.confidence);
}

/**
 * Propose a mapping for every column.
 *
 * ONE FIELD, ONE COLUMN. Two columns both claiming `price` is the common real
 * case (a low and a high estimate), and silently mapping both would make the
 * second overwrite the first. The stronger claim wins the field; the loser is
 * demoted to its next-best candidate and its reason says it was outranked, so
 * the person can see the collision rather than discover it later.
 */
export function inferMapping(
  headers: string[],
  rows: string[][],
  sampleSize = 40,
): ColumnSuggestion[] {
  const sample = rows.slice(0, sampleSize);

  const perColumn = headers.map((header, column) => {
    const values = sample.map((r) => r[column] ?? "");
    const present = values.filter((v) => v.trim() !== "");
    const uniqueRatio =
      present.length === 0 ? 0 : new Set(present).size / present.length;

    const candidates: Candidate[] = [];
    const headerMatch = fromHeader(header);
    if (headerMatch) candidates.push(headerMatch);
    candidates.push(...fromValues(values, uniqueRatio));

    // Deduplicate by field, keeping the strongest evidence for each.
    const best = new Map<CoreFieldKey, Candidate>();
    for (const c of candidates) {
      const existing = best.get(c.field);
      if (!existing || c.confidence > existing.confidence) best.set(c.field, c);
    }
    return {
      column,
      header,
      ranked: [...best.values()].sort((a, b) => b.confidence - a.confidence),
    };
  });

  // Greedy assignment, strongest claim first.
  const taken = new Map<CoreFieldKey, number>();
  const claims = perColumn
    .flatMap((c) => c.ranked.map((r) => ({ column: c.column, ...r })))
    .sort((a, b) => b.confidence - a.confidence);

  const assigned = new Map<number, Candidate>();
  for (const claim of claims) {
    if (taken.has(claim.field)) continue;
    if (assigned.has(claim.column)) continue;
    taken.set(claim.field, claim.column);
    assigned.set(claim.column, claim);
  }

  return perColumn.map((c) => {
    const won = assigned.get(c.column);
    const alternatives = c.ranked
      .filter((r) => r.field !== won?.field)
      .slice(0, 3)
      .map((r) => r.field);

    if (won) {
      return {
        column: c.column,
        header: c.header,
        suggested: won.field,
        confidence: Number(won.confidence.toFixed(2)),
        reason: won.reason,
        alternatives,
      };
    }

    const outranked = c.ranked[0];
    return {
      column: c.column,
      header: c.header,
      suggested: null,
      confidence: 0,
      reason: outranked
        ? `Looked like ${outranked.field}, but another column matched it more strongly`
        : "No confident match — choose a field or leave it as a custom field",
      alternatives,
    };
  });
}
