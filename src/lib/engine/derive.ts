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
//
// ── WHAT THE ENGINE KEEPS, AND WHAT THE TEMPLATE SAYS ───────────────────────
//
// The engine used to hold every layout number — the densities, the caption
// budget at each, the line length at each — as constants, which meant every
// output shape was an engineering ticket (ROADMAP D6). Those numbers now arrive
// in a TEMPLATE (see templates.ts for the whole decision). What stays here is
// the grammar no template may change: how lots become pages, what an entry is,
// how an override applies, and how text is bounded and shortened. The template
// says how many, how wide, in what order, and arranged as what.

import { CORE_FIELDS } from "@/lib/import/fields";

import { intersectsPage, type OverrideFrame } from "./frame";
import {
  BUILT_IN_TEMPLATES,
  densityFor,
  placementFor,
  templateFor,
  type Density,
  type Template,
  type TemplateField,
} from "./templates";

export interface CatalogueParams {
  /**
   * Which template this catalogue is laid out on — by id, never by copy.
   *
   * A copy would freeze the template a house saw the day they chose it; the id
   * means a corrected built-in reaches every catalogue on it, which is what a
   * template is for. The value is a string rather than a union so that a
   * house-authored template (templates.ts, "a templates table") needs no
   * change here.
   */
  template: string;
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
  template: "catalogue",
  perPage: 4,
  imagePlacement: "above",
  showRef: true,
  fit: "page",
};

/**
 * Make sense of whatever `catalogues.params` holds.
 *
 * TOTAL. The column is jsonb and rows exist that were written before there was
 * a `template` key, or by a version whose densities were a constant. Every
 * answer here is resolved AGAINST THE TEMPLATE: a density the template does not
 * offer falls to the template's default, not to a number the engine likes, and
 * a placement the template has no plate for falls to the one it has.
 */
export function normaliseParams(
  raw: unknown,
  library: readonly Template[] = BUILT_IN_TEMPLATES,
): CatalogueParams {
  const source = (raw ?? {}) as Partial<Record<keyof CatalogueParams, unknown>>;
  const template = templateFor(source.template, library);
  return {
    template: template.id,
    perPage: densityFor(template, source.perPage).perPage,
    imagePlacement: placementFor(template, source.imagePlacement),
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
 * about it described where the lot was. Change the TEMPLATE and the same
 * override lands too — a hidden maker is an empty cell in a price list and a
 * missing line in a catalogue, and nothing about it said which.
 *
 * Four kinds now, and the first two are the things a specialist asks for that
 * are not "the record is wrong": leave a field off THIS catalogue, or print
 * something different in THIS catalogue. A typo in a title is neither — it is
 * wrong in every catalogue, and is fixed on the lot, not here.
 *
 * The record is never touched. Remove the override and the record's own value
 * prints again (principle 9: a default, not a lock).
 *
 * The STORED shape carries more than this — plate treatments, a subject box, a
 * straighten (src/lib/data/overrides.ts). None of it is here, because the
 * engine renders no plate treatment and a field in this interface that no
 * output consumes is noise in the one module that has to stay readable.
 */
export interface EngineOverride {
  lotId: string;
  field: string;
  /** Do not print this field in this catalogue. Wins over `text`. */
  hidden?: boolean;
  /** Print this instead of the record's value, in this catalogue only. */
  text?: string;
  /**
   * Where a person PUT this part, in fractions of the page.
   *
   * Not a correction to the value — the same words, somewhere else on the
   * paper. It survives a density change for the reason every other key here
   * does: it says where on ITS page this lot's part sits, and that sentence is
   * as true on the new page as on the old one (src/lib/engine/frame.ts).
   */
  frame?: OverrideFrame;
  /**
   * Which page a person moved this part to. ZERO-BASED. CARRIED AND NOT
   * APPLIED — see `derive`'s note on why, and do not reach for it here without
   * reading it.
   */
  pageIndex?: number;
}

export interface CaptionLine {
  key: string;
  label: string;
  value: string;
}

export interface DocSlot {
  lotId: string;
  /** The reference as this catalogue prints it, or null when it does not. */
  ref: string | null;
  /** Content hash of the plate, or null for a lot with no photograph yet. */
  image: string | null;
  /**
   * The fields this entry carries, in print order, each already bounded to the
   * density. In a table only the fields this lot HAS appear — the document's
   * `columns` say which cells every row has, and the renderer leaves the rest
   * empty.
   */
  caption: CaptionLine[];
  /**
   * The parts of this entry a PERSON placed, by field key — `ref` and `images`
   * included, because those are the same (lot, field) question asked about the
   * two things that are not entries in `fields`.
   *
   * KEYED BY FIELD, not by a position in `caption`, so the renderer asks about
   * the part it is painting rather than counting. Absent when nobody has moved
   * anything, which is every document this system has derived so far and keeps
   * them byte-identical.
   *
   * A frame here has already been checked against the paper; one that has
   * wandered off the page entirely stays in the database and is not applied
   * (src/lib/engine/frame.ts, intersectsPage).
   */
  frames?: Record<string, OverrideFrame>;
}

export interface DocPage {
  /** 1-based, for a human. Nothing is keyed to it. */
  number: number;
  slots: DocSlot[];
}

/**
 * One column of a table, as every row will have it.
 *
 * `key` is a field key, or `ref` for the reference, or `images` for the plate —
 * the two things every arrangement handles by name because they are not
 * entries in `fields`. `width` is the column's share of the row, already
 * resolved from the template's weights: the renderer emits it, it does not
 * compute it.
 */
export interface DocColumn {
  key: string;
  label: string;
  width: number;
}

export interface CatalogueDocument {
  params: CatalogueParams;
  /**
   * The template, whole. The renderer reads THIS DOCUMENT and nothing else, so
   * the declaration it was derived under travels inside it rather than being
   * looked up again by name — two lookups is two chances to disagree.
   */
  template: Template;
  /** The density that was chosen, with its budgets. */
  density: Density;
  /** A table's columns, in order. Empty for a grid or a sheet, whose entries carry their own lines. */
  columns: DocColumn[];
  pages: DocPage[];
  lotCount: number;
  /** Lots the engine placed without a photograph. Shown, never hidden. */
  unphotographed: number;
}

const LABELS = new Map<string, { zh: string; en: string }>(
  CORE_FIELDS.map((f) => [f.key, f.label]),
);

/** A core field's Chinese label; a house's own column under its own name. */
function labelFor(key: string): string {
  return LABELS.get(key)?.zh ?? key;
}

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
 * ── WHY THE TEXT IS BOUNDED HERE AND NOT BY A CSS LINE-CLAMP ────────────────
 *
 * It was. `-webkit-line-clamp` was set on `.line--description`, and it never
 * fired once on real data: the predecessor's long prose does not live in the
 * `description` field at all — it arrived under a column the house calls
 * `notes`, which prints as a custom field and matched no rule. A cap keyed to
 * one field NAME cannot bound a caption, because any field can be long.
 *
 * So the bound is here, field-agnostic and derived. It also does not depend on a
 * browser honouring a prefixed property, which matters when the output is a
 * printed page rather than a screen someone can scroll. The NUMBERS come from
 * the template's density; the RULE — count, shorten, say so — is the engine's.
 */

/** Latin counts one, CJK counts two. Enough to bound a line, not to lay it out. */
function units(text: string): number {
  let total = 0;
  for (const character of text) {
    total += /[ᄀ-ᅟ⺀-꓏ꥠ-꥿가-힣豈-﫿︐-﹯＀-｠￠-￦]/.test(
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

/** Keys that are never caption content, whatever the template says. */
function neverPrints(key: string): boolean {
  return key === "ref" || key === "images" || key.startsWith("_");
}

/**
 * A field competing for the budget: where it prints, and how it survives.
 *
 * `order` is its place in the template's `fields`; `sub` breaks ties among the
 * house's own columns, which all sit at the place of `*` and keep the record's
 * own order among themselves.
 */
interface Candidate {
  key: string;
  label: string;
  value: string;
  width: number;
  priority: number;
  order: number;
  sub: number;
}

const bySurvival = (a: Candidate, b: Candidate): number =>
  a.priority - b.priority || a.order - b.order || a.sub - b.sub;
const byPrint = (a: Candidate, b: Candidate): number =>
  a.order - b.order || a.sub - b.sub;

/** The `*` entry, if the template has one: where the house's own columns go. */
function star(template: Template): { index: number; field: TemplateField } | null {
  const index = template.fields.findIndex((f) => f.key === "*");
  return index < 0 ? null : { index, field: template.fields[index]! };
}

/**
 * Choose what an entry carries: the named fields by priority, then the house's
 * own columns where `*` puts them, until the budget is spent. Then put them
 * back in print order.
 *
 * ONE RULE FOR EVERY ARRANGEMENT. A grid decides per lot, because a lot with no
 * maker has a line to spare; a table decides once for the document, because
 * every row must have the same columns. Both call this with a different set of
 * candidates and the same budget.
 */
function choose(candidates: Candidate[], budget: number): Candidate[] {
  return [...candidates].sort(bySurvival).slice(0, budget).sort(byPrint);
}

/**
 * Named candidates: the fields the template lists.
 *
 * With a record, only those the record has a value for — a grid does not spend
 * a line on an absent maker. With `null`, every one of them — a table's column
 * exists whether or not this row fills it.
 */
function namedCandidates(
  template: Template,
  fields: Record<string, unknown> | null,
): Candidate[] {
  const out: Candidate[] = [];
  template.fields.forEach((field, index) => {
    if (field.key === "*" || neverPrints(field.key)) return;
    const value = fields ? asText(fields[field.key]) : "";
    if (fields && !value) return;
    out.push({
      key: field.key,
      label: labelFor(field.key),
      value,
      width: field.width,
      priority: field.priority ?? index,
      order: index,
      sub: 0,
    });
  });
  return out;
}

/**
 * The house's own columns: every key the record carries that the template did
 * not name. THEY PRINT UNDER THE CUSTOMER'S OWN HEADER — the field set is
 * theirs — but only where the template has a `*` for them and only while there
 * is room.
 *
 * EXCEPT KEYS PREFIXED WITH `_`, which are carried data rather than caption
 * content — the predecessor's separate numeric columns for height, width and
 * estimate, kept because they are the house's own values and dropping them is
 * not this system's decision to make. They printed, at first, as a column of
 * bare numbers under every migrated lot: "301", "144", "84.9". The dimensions
 * and the estimate already print, in the form a person wrote them.
 */
function customCandidates(
  template: Template,
  records: Record<string, unknown>[],
  seen: Set<string>,
): Candidate[] {
  const place = star(template);
  if (!place) return [];
  const out: Candidate[] = [];
  // ONE COUNTER ACROSS EVERY RECORD. A table unions its columns over all the
  // lots, and a counter that restarted per lot let a later lot's column sort
  // ahead of an earlier lot's — found by the test, not by the eye.
  for (const fields of records) {
    for (const [key, raw] of Object.entries(fields)) {
      if (seen.has(key) || neverPrints(key)) continue;
      const value = asText(raw);
      if (!value) continue;
      seen.add(key);
      out.push({
        key,
        label: labelFor(key),
        value,
        width: place.field.width,
        priority: place.field.priority ?? place.index,
        order: place.index,
        sub: out.length,
      });
    }
  }
  return out;
}

const named = (template: Template): Set<string> =>
  new Set(template.fields.map((f) => f.key));

/** A grid's or a sheet's caption: this lot's own lines, chosen and bounded. */
function captionFor(lot: EngineLot, template: Template, density: Density): CaptionLine[] {
  const candidates = [
    ...namedCandidates(template, lot.fields),
    ...customCandidates(template, [lot.fields], named(template)),
  ];
  return choose(candidates, density.fields).map(({ key, label, value }) => ({
    key,
    label,
    value: clip(value, density.units),
  }));
}

/**
 * A table's columns, decided ONCE for the whole document.
 *
 * A grid drops the fields a lot does not have; a table cannot, because a row
 * with its maker in the estimate column is a wrong price list, not a compact
 * one. So the named fields are candidates whether or not any lot has them, the
 * house's own columns are the UNION across the lots in first-seen order, and
 * the budget chooses once. The reference leads if the template prints it and
 * this catalogue does; the plate follows it as a thumbnail column.
 *
 * Widths are resolved here from the template's weights so the renderer emits a
 * share and computes nothing — the plate takes its declared share of the row
 * and the text columns divide the rest.
 */
function tableColumns(
  template: Template,
  density: Density,
  lots: EngineLot[],
  showRef: boolean,
): DocColumn[] {
  const candidates = [
    ...namedCandidates(template, null),
    ...customCandidates(template, lots.map((l) => l.fields), named(template)),
  ];
  const kept = choose(candidates, density.fields);

  const refField = template.fields.find((f) => f.key === "ref");
  const plateShare = template.plate?.beside ?? 0;
  const text: { key: string; label: string; weight: number }[] = [];
  if (refField && showRef) text.push({ key: "ref", label: labelFor("ref"), weight: refField.width });
  for (const c of kept) text.push({ key: c.key, label: c.label, weight: c.width });
  const total = text.reduce((sum, c) => sum + c.weight, 0) || 1;
  const textShare = 1 - plateShare;

  const columns: DocColumn[] = text.map((c) => ({
    key: c.key,
    label: c.label,
    width: (textShare * c.weight) / total,
  }));
  if (template.plate) {
    const at = refField && showRef ? 1 : 0;
    columns.splice(at, 0, { key: "images", label: "", width: plateShare });
  }
  return columns;
}

/**
 * A table row: a value for each column this lot has, bounded to the column's
 * share of the row's budget. The reference and the plate are the slot's own.
 */
function rowFor(lot: EngineLot, columns: DocColumn[], density: Density): CaptionLine[] {
  const textShare = columns
    .filter((c) => c.key !== "images")
    .reduce((sum, c) => sum + c.width, 0) || 1;
  const lines: CaptionLine[] = [];
  for (const column of columns) {
    if (column.key === "ref" || column.key === "images") continue;
    const value = asText(lot.fields[column.key]);
    if (!value) continue;
    const budget = Math.max(8, Math.round((density.units * column.width) / textShare));
    lines.push({ key: column.key, label: column.label, value: clip(value, budget) });
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
 * house's own sequence, which they set deliberately. THE SAME PAGINATION FOR
 * EVERY TEMPLATE: a price list of twenty rows a page keeps a pinned pair on one
 * page exactly as a four-up grid does, because the pin never said which.
 *
 * Overrides are applied HERE, on every derivation, and not by the caller before
 * the lots arrive. The alternative — a data layer that hands the engine
 * already-corrected lots — would make the engine unable to say which values are
 * the record's and which are this catalogue's, and would put the one place a
 * correction is interpreted outside the one function every output shares.
 *
 * ── WHY `pageIndex` IS CARRIED AND NOT HONOURED ─────────────────────────────
 *
 * An override may name a page. This engine does not put anything on it, and
 * that is a conclusion rather than an omission. Three reasons, any one of which
 * is enough:
 *
 * IT NAMES A PAGE FOR A FIELD, NOT FOR A LOT. The key is (lot, field), so the
 * honest reading is "the title of P22 is on page three" while P22's plate is on
 * page one. A `DocPage` holds `DocSlot`s and a slot is one lot whole; there is
 * nowhere in this document for a field that has left its entry. Inventing a
 * page-level element list here would be inventing a document shape ahead of the
 * renderer that has to paint it, and ahead of the drag that would produce it.
 *
 * REINTERPRETING IT AS "MOVE THE LOT" CONTRADICTS THE STORAGE. Two fields of
 * one lot may name two different pages, and every tiebreak is arbitrary. It
 * also breaks the pagination invariants in both directions at once: a named
 * page already holding `perPage` lots would gain an extra slot the grid cannot
 * hold — rows and columns are declared so that every slot on a page is the same
 * box — and the page the lot left keeps a hole, because back-filling would
 * reorder the house's own sequence, which is the rule the pin below already
 * refuses to break. A keeping-together pin whose members are sent to different
 * pages is the same contradiction with a name.
 *
 * A PAGE NUMBER IS POSITIONAL, WHICH IS THE ONE THING AN OVERRIDE MAY NOT BE.
 * Page five at 4-up is not page five at 9-up (principle 1, and this file's own
 * header). A stored 5 means somewhere different after every density change, so
 * the one thing an override exists to survive is the thing it cannot. The
 * predecessor could carry it because its pages were PERSISTED objects a person
 * had made, and re-deriving there was a deliberate "regenerate" that counted
 * the edits it was about to break. Here derivation is continuous.
 *
 * So it is stored, it round-trips, it reaches this interface, and nothing reads
 * it. The day a person can add a page and put a part on it, the page they mean
 * will be identified by something that survives repagination, and this key will
 * be read then or replaced by that one. What must not happen in the meantime is
 * a guess that moves a client's artwork somewhere nobody asked for.
 *
 * `library` is the templates that exist. The built-ins by default; the day a
 * house authors one, the data layer appends it here and nothing else changes.
 */
export function derive(
  lots: EngineLot[],
  params: CatalogueParams = DEFAULT_PARAMS,
  pins: EnginePin[] = [],
  overrides: EngineOverride[] = [],
  library: readonly Template[] = BUILT_IN_TEMPLATES,
): CatalogueDocument {
  const template = templateFor(params.template, library);
  const density = densityFor(template, params.perPage);
  const perPage = density.perPage;
  const imagePlacement = placementFor(template, params.imagePlacement);
  // A template that does not name the reference prints none; this catalogue
  // may then also choose not to. Either way the slot says null.
  const showRef = params.showRef && template.fields.some((f) => f.key === "ref");

  const overridesByLot = new Map<string, EngineOverride[]>();
  for (const override of overrides) {
    const own = overridesByLot.get(override.lotId);
    if (own) own.push(override);
    else overridesByLot.set(override.lotId, [override]);
  }
  // Every lot as this catalogue prints it, BEFORE anything is arranged: a
  // table's columns are the union of what the printed lots carry, so a hidden
  // field must already be gone when the columns are chosen.
  const printedOf = new Map<string, EngineLot>();
  for (const lot of lots) {
    const own = overridesByLot.get(lot.id);
    printedOf.set(lot.id, own ? applyOverrides(lot, own) : lot);
  }
  const printedLots = lots.map((lot) => printedOf.get(lot.id)!);

  // Where a person put things, gathered per lot before anything is paginated —
  // a placement is a property of the LOT's parts and says nothing about which
  // page the lot lands on. A frame that has left the paper entirely is dropped
  // here rather than in the renderer: it is the engine that decides what
  // applies, and an edit nobody can see is an edit nobody can drag back.
  const framesOf = new Map<string, Record<string, OverrideFrame>>();
  for (const override of overrides) {
    if (!override.frame || !intersectsPage(override.frame)) continue;
    const own = framesOf.get(override.lotId) ?? {};
    own[override.field] = override.frame;
    framesOf.set(override.lotId, own);
  }

  const columns =
    template.arrangement === "table"
      ? tableColumns(template, density, printedLots, showRef)
      : [];
  const linesFor = (printed: EngineLot): CaptionLine[] =>
    template.arrangement === "table"
      ? rowFor(printed, columns, density)
      : captionFor(printed, template, density);

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
      const printed = printedOf.get(lot.id)!;
      const frames = framesOf.get(lot.id);
      current.push({
        lotId: lot.id,
        ref: showRef ? printed.ref : null,
        image: printed.images[0] ?? null,
        caption: linesFor(printed),
        ...(frames ? { frames } : {}),
      });
      if (current.length === perPage) flush();
    }
  }
  flush();

  return {
    params: { ...params, template: template.id, perPage, imagePlacement },
    template,
    density,
    columns,
    pages,
    lotCount: lots.length,
    unphotographed: lots.filter((l) => l.images.length === 0).length,
  };
}
