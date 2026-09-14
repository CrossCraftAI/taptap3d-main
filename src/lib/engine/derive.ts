// The engine: a placement for every lot, derived.
//
// PURE. Lots in, a document out. No database, no filesystem, no rendered output
// read back — ARCHITECTURE.md, "the engine never reads rendered output". The
// geometry it needs about a photograph is measured once and stored against the
// asset, never scraped from a render.
//
// The document it emits is the ONLY thing the renderer reads. That is what makes
// "one renderer behind every output" enforceable rather than aspirational: the
// preview, the PDF and the listing are three consumers of this one tree, so a
// preview that stops resembling the deliverable is a bug in one place.
//
// NOTHING HERE IS KEYED POSITIONALLY. A slot knows which lot it holds; it does
// not have an identity of its own that anything else may reference. The same lot
// is the fifth slot of page one at 9-up and the first slot of page three at 2-up,
// and an override keyed to either of those descriptions would be destroyed by the
// next density change (principle 1).

import { CORE_FIELDS, type CoreFieldKey } from "@/lib/import/fields";

export interface CatalogueParams {
  /** Lots per page. The one parameter a specialist changes constantly. */
  perPage: number;
  /** Where the photograph sits relative to its caption. */
  imagePlacement: "above" | "beside";
  /** Whether the house's own reference prints. Some houses do not use one. */
  showRef: boolean;
  /**
   * How the preview sizes a page: a whole page in the frame, or the page filled
   * to the frame's width.
   *
   * A VIEWING parameter, and the only one here that is. It changes nothing about
   * the document — the same tree renders either way — but it lives beside the
   * layout parameters because a specialist reaches for it in the same breath,
   * and because the predecessor shipped these two as separate controls that
   * BEHAVED IDENTICALLY in two-up (ROADMAP M1, carried defects). They differ
   * here at every density, which is the whole point of naming them apart.
   */
  fit: "page" | "width";
}

export const DEFAULT_PARAMS: CatalogueParams = {
  perPage: 4,
  imagePlacement: "above",
  showRef: true,
  fit: "page",
};

/** The densities offered. Not arbitrary: each divides a page without a remainder. */
export const DENSITIES = [1, 2, 4, 6, 9] as const;

export function normaliseParams(raw: unknown): CatalogueParams {
  const source = (raw ?? {}) as Partial<CatalogueParams>;
  const perPage = DENSITIES.includes(source.perPage as (typeof DENSITIES)[number])
    ? (source.perPage as number)
    : DEFAULT_PARAMS.perPage;
  return {
    perPage,
    imagePlacement:
      source.imagePlacement === "beside" ? "beside" : DEFAULT_PARAMS.imagePlacement,
    showRef: source.showRef !== false,
    fit: source.fit === "width" ? "width" : DEFAULT_PARAMS.fit,
  };
}

export interface EngineLot {
  id: string;
  ref: string | null;
  fields: Record<string, unknown>;
  /** Content hashes, primary first. The engine reads `images[0]` and no more. */
  images: string[];
}

/**
 * A pin, as the engine sees it: a set of lots and whether they must share a page.
 *
 * Keyed by MEMBERS, never by page index — a page number is as positional as an
 * element id, and page 5 at 3-up holds different lots than page 5 at 9-up.
 */
export interface EnginePin {
  keepsTogether: boolean;
  lotIds: string[];
}

/**
 * An override, as the engine sees it: one judgement about one field of one lot
 * IN THIS CATALOGUE.
 *
 * Keyed `(lot, field)` — never to a slot, a page or an element id (principle 1).
 * It is a VALUE the engine re-applies on every derivation (principle 2): change
 * the density and the same override lands on the same lot, because nothing
 * about it described where the lot was.
 *
 * Two kinds, because these are the two things a specialist asks for that are
 * not "the record is wrong": leave a field off THIS catalogue, or print something
 * different in THIS catalogue. A typo in a title is neither — it is wrong in
 * every catalogue, and is fixed on the lot, not here.
 *
 * The record is never touched. Remove the override and the record's own value
 * prints again (principle 9: a default, not a lock).
 */
export interface EngineOverride {
  lotId: string;
  field: string;
  /** Do not print this field in this catalogue. Wins over `text`. */
  hidden?: boolean;
  /** Print this instead of the record's value, in this catalogue only. */
  text?: string;
}

export interface CaptionLine {
  key: string;
  label: string;
  value: string;
}

export interface DocSlot {
  lotId: string;
  ref: string | null;
  /** Content hash of the plate, or null for a lot with no photograph yet. */
  image: string | null;
  caption: CaptionLine[];
}

export interface DocPage {
  /** 1-based, for a human. Nothing is keyed to it. */
  number: number;
  slots: DocSlot[];
}

export interface CatalogueDocument {
  params: CatalogueParams;
  pages: DocPage[];
  lotCount: number;
  /** Lots the engine placed without a photograph. Shown, never hidden. */
  unphotographed: number;
}

const CAPTION_ORDER: CoreFieldKey[] = [
  "title",
  "maker",
  "date",
  "material",
  "dimensions",
  "price",
  "description",
];

const LABELS = new Map(CORE_FIELDS.map((f) => [f.key, f.label]));

/**
 * A field value as a caption reads it.
 *
 * Values arrive as the importer left them — strings, verbatim, uncoerced. A
 * migrated lot may carry a nested shape from the predecessor's bilingual
 * columns, so objects are flattened rather than rendered as `[object Object]`,
 * which is what the first version of this did on the first migrated row.
 */
export function asText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(asText).filter(Boolean).join(", ");
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    // Traditional Chinese first: the first customers work in it, and where both
    // are present it is the one that prints larger.
    const preferred = ["zh", "en", "value", "display"];
    for (const key of preferred) {
      if (key in record) {
        const text = asText(record[key]);
        if (text) return text;
      }
    }
    return Object.values(record).map(asText).filter(Boolean).join(" ");
  }
  return "";
}

/**
 * How many entries a caption may carry at each density.
 *
 * THE ENGINE DECIDES THIS, not the stylesheet, because it is a property of the
 * document rather than of how it is painted — and because it must be re-derived
 * when the density changes rather than clipped after the fact.
 *
 * The migration brought the predecessor's own columns across (notes, sealMarks,
 * substrate, provenance), and they are the house's data so they are kept. But a
 * caption prints every field it does not recognise, so a four-up page grew
 * captions of eleven entries into a box that holds six, and the overflow was cut
 * mid-sentence. On screen a fade reads as "there is more". On paper there is no
 * more, and it reads as a printing fault.
 *
 * A default, not a lock (principle 9): the core fields a catalogue prints fill
 * the budget first, the house's own columns take what is left, and nothing is
 * deleted — the lot page shows every value it holds.
 */
const CAPTION_BUDGET: Record<number, number> = { 1: 20, 2: 12, 4: 8, 6: 6, 9: 4 };

/**
 * Which core field goes first when they do not all fit.
 *
 * NOT the order they print in — that is CAPTION_ORDER and it does not change.
 * This is the order they SURVIVE in, and it is the trade's own answer: a dense
 * page carries the work, who made it and what it is expected to fetch. The
 * description is the first thing a nine-up page gives up and the last thing a
 * one-up page would.
 *
 * Dropping the estimate to keep the medium would be the obvious bug here.
 */
const CAPTION_PRIORITY: CoreFieldKey[] = [
  "title",
  "maker",
  "price",
  "date",
  "dimensions",
  "material",
  "description",
];

/**
 * How long one caption line may be, in units, at each density.
 *
 * A Chinese character is counted as two because it occupies about twice the
 * advance of a Latin one, so a single budget serves a bilingual catalogue
 * without needing to know which language a value is in.
 *
 * ── WHY THIS IS NOT A CSS LINE-CLAMP ────────────────────────────────────────
 *
 * It was. `-webkit-line-clamp` was set on `.line--description`, and it never
 * fired once on real data: the predecessor's long prose does not live in the
 * `description` field at all — it arrived under a column the house calls
 * `notes`, which prints as a custom field and matched no rule. A cap keyed to
 * one field NAME cannot bound a caption, because any field can be long.
 *
 * So the bound is here, field-agnostic and derived. It also does not depend on a
 * browser honouring a prefixed property, which matters when the output is a
 * printed page rather than a screen someone can scroll.
 */
const LINE_BUDGET: Record<number, number> = {
  1: 900,
  2: 460,
  4: 170,
  6: 96,
  9: 44,
};

/** Latin counts one, CJK counts two. Enough to bound a line, not to lay it out. */
function units(text: string): number {
  let total = 0;
  for (const character of text) {
    total += /[ᄀ-ᅟ⺀-꓏ꥠ-꥿가-힣豈-﫿︐-﹯＀-｠￠-￦]/.test(
      character,
    )
      ? 2
      : 1;
  }
  return total;
}

/**
 * Shorten to fit, and SAY SO with an ellipsis.
 *
 * The stored value is untouched — this is a derivation, re-run on every change
 * of density, and the lot page still shows the whole thing.
 */
function clip(text: string, budget: number): string {
  if (units(text) <= budget) return text;
  let total = 0;
  let kept = "";
  for (const character of text) {
    const width = units(character);
    if (total + width > budget - 1) break;
    total += width;
    kept += character;
  }
  return `${kept.trimEnd()}…`;
}

function captionFor(lot: EngineLot, budget: number, lineBudget: number): CaptionLine[] {
  const present = CAPTION_ORDER.filter((key) => asText(lot.fields[key]) !== "");
  // Chosen by priority, then printed in the catalogue's own order.
  const keep = new Set(
    CAPTION_PRIORITY.filter((key) => present.includes(key)).slice(0, budget),
  );
  const lines: CaptionLine[] = [];
  for (const key of CAPTION_ORDER) {
    if (!keep.has(key)) continue;
    const value = asText(lot.fields[key]);
    if (!value) continue;
    lines.push({ key, label: LABELS.get(key)?.zh ?? key, value: clip(value, lineBudget) });
  }
  // CUSTOM FIELDS PRINT TOO, under the customer's own header — but AFTER the
  // core fields and only while there is room. The field set is theirs; a column
  // they asked to keep and then never see again is a column we silently
  // discarded with extra steps. A caption that runs off the page is not showing
  // it to them either.
  //
  // EXCEPT KEYS PREFIXED WITH `_`, which are carried data rather than caption
  // content — the predecessor's separate numeric columns for height, width and
  // estimate, kept because they are the house's own values and dropping them is
  // not this system's decision to make. They printed, at first, as a column of
  // bare numbers under every migrated lot: "301", "144", "84.9". The dimensions
  // and the estimate already print, in the form a person wrote them.
  for (const [key, raw] of Object.entries(lot.fields)) {
    if (CAPTION_ORDER.includes(key as CoreFieldKey)) continue;
    if (key === "ref" || key === "images" || key.startsWith("_")) continue;
    if (lines.length >= budget) break;
    const value = asText(raw);
    if (!value) continue;
    lines.push({ key, label: key, value: clip(value, lineBudget) });
  }
  return lines;
}

/**
 * The lot as THIS catalogue prints it: the record with its overrides applied.
 *
 * Returns a new object and never writes into the lot it was given — the record
 * is the caller's and is the same record every other catalogue derives from.
 *
 * `ref` and `images` are not entries in `fields`, so they are handled by name:
 * a house that wants one lot's reference off the page, or one lot printed
 * without its plate in this catalogue, is asking the same (lot, field) question
 * and gets the same answer. A `text` on `images` is ignored, because a plate is
 * a content hash and not a thing anybody types.
 */
function applyOverrides(lot: EngineLot, own: EngineOverride[]): EngineLot {
  const fields = { ...lot.fields };
  let ref = lot.ref;
  let images = lot.images;
  for (const override of own) {
    if (override.hidden) {
      if (override.field === "ref") ref = null;
      else if (override.field === "images") images = [];
      else delete fields[override.field];
      continue;
    }
    if (override.text === undefined) continue;
    if (override.field === "ref") ref = override.text;
    else if (override.field !== "images") fields[override.field] = override.text;
  }
  return { id: lot.id, ref, fields, images };
}

/**
 * Derive a document.
 *
 * Pagination is file order, chunked by density, with one exception: a pin that
 * `keepsTogether` is not split across a page break. When its members do not fit
 * in what is left of a page, the whole group moves to the next one and the gap
 * is left visible rather than back-filled — back-filling would reorder the
 * house's own sequence, which they set deliberately.
 *
 * Overrides are applied HERE, on every derivation, and not by the caller before
 * the lots arrive. The alternative — a data layer that hands the engine
 * already-corrected lots — would make the engine unable to say which values are
 * the record's and which are this catalogue's, and would put the one place a
 * correction is interpreted outside the one function every output shares.
 */
export function derive(
  lots: EngineLot[],
  params: CatalogueParams = DEFAULT_PARAMS,
  pins: EnginePin[] = [],
  overrides: EngineOverride[] = [],
): CatalogueDocument {
  const perPage = Math.max(1, params.perPage);

  const overridesByLot = new Map<string, EngineOverride[]>();
  for (const override of overrides) {
    const own = overridesByLot.get(override.lotId);
    if (own) own.push(override);
    else overridesByLot.set(override.lotId, [override]);
  }

  // Which pin, if any, holds each lot. A lot in two keeping-together pins is a
  // contradiction the data layer should prevent; here the first one wins, so the
  // engine stays total.
  const groupOf = new Map<string, string>();
  for (const pin of pins) {
    if (!pin.keepsTogether) continue;
    const groupId = pin.lotIds.join("|");
    for (const lotId of pin.lotIds) {
      if (!groupOf.has(lotId)) groupOf.set(lotId, groupId);
    }
  }

  // Runs of consecutive lots that must stay together, in file order.
  const runs: EngineLot[][] = [];
  for (const lot of lots) {
    const group = groupOf.get(lot.id);
    const last = runs[runs.length - 1];
    const lastGroup = last?.[0] ? groupOf.get(last[0].id) : undefined;
    if (group && last && lastGroup === group) last.push(lot);
    else runs.push([lot]);
  }

  const pages: DocPage[] = [];
  let current: DocSlot[] = [];
  const flush = (): void => {
    if (current.length === 0) return;
    pages.push({ number: pages.length + 1, slots: current });
    current = [];
  };

  for (const run of runs) {
    // A run longer than a page cannot be kept together by any pagination; it is
    // placed rather than refused, because refusing mid-pitch is worse than a
    // group that spans a spread.
    if (run.length <= perPage && current.length + run.length > perPage) flush();
    for (const lot of run) {
      const own = overridesByLot.get(lot.id);
      const printed = own ? applyOverrides(lot, own) : lot;
      current.push({
        lotId: lot.id,
        ref: params.showRef ? printed.ref : null,
        image: printed.images[0] ?? null,
        caption: captionFor(
          printed,
          CAPTION_BUDGET[perPage] ?? 8,
          LINE_BUDGET[perPage] ?? 170,
        ),
      });
      if (current.length === perPage) flush();
    }
  }
  flush();

  return {
    params: { ...params, perPage },
    pages,
    lotCount: lots.length,
    unphotographed: lots.filter((l) => l.images.length === 0).length,
  };
}
