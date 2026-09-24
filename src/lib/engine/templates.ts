// Templates: what an output LOOKS LIKE, as data.
//
// A catalogue, a price list and a tearsheet are three outputs of one record.
// Before this file they would have been three screens with three layouts, and
// ARCHITECTURE.md principle 6 says exactly where that ends: the predecessor had
// two renderers and its preview stopped resembling its deliverable. So a
// template is a DECLARATION the one engine reads and the one renderer paints —
// never a function, never markup, never a painter of its own.
//
// ── HOW MUCH STRUCTURE THE ENGINE KEEPS ─────────────────────────────────────
//
// This was the open question in ROADMAP D6 and it is settled here, in one
// sentence: THE ENGINE KEEPS THE GRAMMAR AND THE TEMPLATE SUPPLIES THE WORDS.
//
// The engine keeps, and no template may change:
//
//   - Pagination. File order, chunked by density, a pin never split, a gap left
//     rather than back-filled. There is one honest algorithm and the pin and
//     override contracts are keyed against it (principle 1). A template that
//     could paginate differently would be a template that could orphan a pin.
//   - The ENTRY. A lot on a page is three things — a reference, a plate, and
//     lines of (field, value) — in every output. What differs is how the three
//     are arranged and how much room each gets.
//   - Three ARRANGEMENTS, a closed set: a grid of cells, a table of rows under
//     a header, a sheet that is a page. The renderer knows how to paint each,
//     the way HTML knows a table from a list. A template picks one.
//   - Everything that is a rule about DATA rather than about a page: which
//     override wins, how a bilingual value flattens, that a carried numeric
//     under an underscore never prints, that a shortened line says so with an
//     ellipsis.
//
// The template declares, and the engine obeys:
//
//   - The arrangement, the page (size, orientation, margin) and the type size.
//   - The DENSITIES it offers, each with its budgets: how many fields an entry
//     carries, how many lines its caption may run to, how long one line may be.
//     These were constants in the engine (CAPTION_BUDGET, LINE_BUDGET,
//     DENSITIES) and in the renderer (GRID, captionLines) and they are layout
//     facts, so they were never the engine's to hold. A house that wants a
//     seven-line caption at four-up changes a number here, not the engine.
//   - Where the plate sits and how much of the entry it takes, or that there is
//     no plate at all.
//   - Which FIELDS print, in what order, which survive when the budget is
//     short, how wide each column is in a table, and which carry their label.
//
// ── REJECTED ────────────────────────────────────────────────────────────────
//
// MORE KNOBS ON THE GRID. A parameter for everything the grid does still only
// describes grids. A price list is a table and no number turns a cell into a
// row. If the vocabulary could not say "table" it was not a vocabulary.
//
// A BOX-GEOMETRY LANGUAGE — x, y, width, height, flows. It is Canva, which
// principle 3 rejected: simple precisely because it never repaginates. To place
// text in boxes the engine would have to measure text, which is reading
// rendered output, which the engine may not do. It is the hardest thing for a
// house — or the AI in D7 — to author well, and the defect gate in D8 could
// not be written against it because anything is expressible.
//
// TEMPLATES THAT CARRY MARKUP OR CSS. That is a second renderer by another
// name, and stored markup is what principle 2 rejected. It is also a security
// hole: the preview frame is inert because its document carries a CSP with no
// script-src, and a template that can write into that document can write a
// script tag into it.
//
// A DISCRIMINATED UNION, one schema per arrangement. More precise, and three
// schemas is three vocabularies to learn and three to generate. One flat shape
// with a handful of refinements is what a person or a model can hold in their
// head, and the refinements say in words which combinations are meaningless.
//
// A `templates` TABLE. DFD.md §2: "named only" must not mean an empty table
// shipped in advance, and nobody authors a template inside the system yet. The
// built-ins are validated constants and `catalogues.params.template` names one
// by id. The shape is open for the day a house does: `templateSchema` is the
// gate a stored jsonb row or an AI's proposal would pass through, `derive()`
// takes the library of templates as an argument, and an id is a string rather
// than an enum. The table arrives with its first writer and the engine does
// not change.

import { z } from "zod";

/** A share of an entry or a row: never nothing, never everything. */
const share = z.number().min(0.05).max(0.95);

/**
 * One density a template offers, with its budgets.
 *
 * The four numbers are the four ways a caption can overflow, and every one of
 * them was a constant somewhere before: `perPage` and `columns` were the
 * renderer's GRID table, `fields` was CAPTION_BUDGET, `lines` was captionLines,
 * `units` was LINE_BUDGET. Together they say how much text one entry may carry
 * at this density so the engine bounds it BEFORE painting, rather than the
 * stylesheet clipping it after (see derive.ts on why a CSS clamp failed).
 */
export const densitySchema = z.object({
  /** Entries on a page. */
  perPage: z.number().int().min(1).max(200),
  /** Grid only: how many across. Rows follow from perPage. */
  columns: z.number().int().min(1).max(12).optional(),
  /** How many fields an entry may carry. The reference is never counted. */
  fields: z.number().int().min(0).max(60),
  /**
   * How many text lines the entry's caption may run to before it is contained.
   * In a table, lines per cell.
   */
  lines: z.number().int().min(1).max(400),
  /**
   * How long one field's text may run, Latin counting one and a Chinese
   * character two. In a table this is the whole row's budget, split between
   * the columns by their widths.
   */
  units: z.number().int().min(8).max(50_000),
});

/**
 * One field an entry prints.
 *
 * Array order is PRINT order. `priority` is SURVIVAL order — which fields keep
 * their place when the density's budget is short — and defaults to the print
 * order when not given. They differ in a catalogue because the trade's answer
 * differs: the description prints last and is also the first thing given up,
 * but the estimate prints near the end and is the third thing kept.
 *
 * Two keys are special. `ref` is the house's own reference: it prints where it
 * is placed, is never budgeted or shortened, and a template that leaves it out
 * prints no reference at all. `*` is the house's own columns — every field the
 * record carries that the template did not name — printed where `*` sits,
 * taking whatever budget the named fields left. A template without `*` prints
 * only what it names, which is what a price list is.
 */
export const fieldSchema = z.object({
  key: z
    .string()
    .min(1)
    .max(80)
    .refine((key) => key !== "images", {
      message: "the plate is declared by `plate`, not as a field",
    })
    .refine((key) => !key.startsWith("_"), {
      message: "keys under an underscore are carried data and never print",
    }),
  priority: z.number().int().min(0).optional(),
  /** Table only: the column's weight relative to the other text columns. */
  width: z.number().min(0.1).max(20).default(1),
  /** Print the field's name before its value. A table's header does this for every column. */
  label: z.boolean().default(false),
});

export const templateSchema = z
  .object({
    /** A slug. Stored in `catalogues.params.template`; never shown as a name. */
    id: z.string().regex(/^[a-z][a-z0-9-]{1,40}$/),
    /** Bilingual, because the first customers work in Traditional Chinese. */
    name: z.object({ zh: z.string().min(1).max(40), en: z.string().min(1).max(40) }),
    /** One line for the person choosing: what this output is FOR. */
    purpose: z.string().min(1).max(200),
    arrangement: z.enum(["grid", "table", "sheet"]),
    page: z.object({
      /** A4 today. The place for A5 and Letter is here, not in the renderer. */
      size: z.enum(["A4"]),
      orientation: z.enum(["portrait", "landscape"]),
      /** All four sides, as a percentage of the page's width. */
      margin: z.number().min(0).max(20),
    }),
    type: z.object({
      /**
       * The body size as a percentage of the page's height, so it scales with
       * the preview and prints at a fixed size on a fixed page.
       */
      body: z.number().min(0.4).max(5),
      /** The largest it ever prints, in CSS pixels. 12px is 9pt. */
      cap: z.number().int().min(7).max(48),
    }),
    densities: z.array(densitySchema).min(1).max(12),
    /** Where a new catalogue on this template starts. Must be one of the densities. */
    defaultPerPage: z.number().int().min(1),
    /**
     * The plate's share of the entry for each placement the template offers —
     * of the entry's height when above the caption, of its width when beside.
     * A placement that is not offered is absent; `null` means no plate at all.
     * In a table the plate is a column and `beside` is its share of the row.
     */
    plate: z
      .object({ above: share.optional(), beside: share.optional() })
      .nullable(),
    fields: z.array(fieldSchema).min(1).max(60),
  })
  .superRefine((template, ctx) => {
    const issue = (message: string, path: (string | number)[] = []): void => {
      ctx.addIssue({ code: "custom", message, path });
    };

    const perPages = template.densities.map((d) => d.perPage);
    if (new Set(perPages).size !== perPages.length) {
      issue("each density must be offered once", ["densities"]);
    }
    if (!perPages.includes(template.defaultPerPage)) {
      issue("the default density must be one of those offered", ["defaultPerPage"]);
    }

    template.densities.forEach((density, index) => {
      const path = ["densities", index];
      if (template.arrangement === "grid") {
        if (density.columns === undefined) {
          issue("a grid density must say how many columns it has", [...path, "columns"]);
        } else if (density.perPage % density.columns !== 0) {
          issue("a grid's columns must divide its density — a grid with a hole in it is a grid nobody chose", [...path, "columns"]);
        }
      } else if (density.columns !== undefined) {
        issue("only a grid has columns", [...path, "columns"]);
      }
      if (template.arrangement === "sheet" && density.perPage !== 1) {
        issue("a sheet is one entry to a page; more than one is a grid", [...path, "perPage"]);
      }
    });

    if (template.plate) {
      if (template.plate.above === undefined && template.plate.beside === undefined) {
        issue("a plate must be offered somewhere, or be null", ["plate"]);
      }
      if (template.arrangement === "table" && template.plate.above !== undefined) {
        issue("a table's plate is a column beside the text; above a row means nothing", ["plate", "above"]);
      }
    }

    const keys = template.fields.map((f) => f.key);
    if (new Set(keys).size !== keys.length) {
      issue("each field may be declared once", ["fields"]);
    }
  });

export type Template = z.infer<typeof templateSchema>;
export type TemplateInput = z.input<typeof templateSchema>;
export type Density = z.infer<typeof densitySchema>;
export type TemplateField = z.infer<typeof fieldSchema>;
export type Arrangement = Template["arrangement"];
export type Placement = "above" | "beside";

// ── The built-ins ───────────────────────────────────────────────────────────
//
// Parsed at module load, so a wrong number here fails the first test and the
// build rather than the printer. Each is the SAME vocabulary saying something
// structurally different: cells, rows, a page.

/**
 * The printed sale catalogue — what this system rendered before it had a
 * second template. Every number below was a constant in derive.ts or html.ts
 * and the output is byte-for-byte what it was; the difference is that a house
 * can now read the numbers and change them.
 */
export const CATALOGUE: Template = templateSchema.parse({
  id: "catalogue",
  name: { zh: "圖錄", en: "Catalogue" },
  purpose: "Plates in a grid with a caption under each. The printed sale catalogue.",
  arrangement: "grid",
  page: { size: "A4", orientation: "portrait", margin: 5 },
  type: { body: 1.1, cap: 12 },
  densities: [
    { perPage: 1, columns: 1, fields: 20, lines: 24, units: 900 },
    { perPage: 2, columns: 1, fields: 12, lines: 16, units: 460 },
    { perPage: 4, columns: 2, fields: 8, lines: 11, units: 170 },
    { perPage: 6, columns: 2, fields: 6, lines: 8, units: 96 },
    { perPage: 9, columns: 3, fields: 4, lines: 6, units: 44 },
  ],
  defaultPerPage: 4,
  plate: { above: 0.62, beside: 0.44 },
  // Print order is the catalogue's convention; priority is the trade's answer
  // to what a dense page keeps — the work, who made it, what it should fetch.
  // Dropping the estimate to keep the medium would be the obvious bug.
  fields: [
    { key: "ref" },
    { key: "title", priority: 1 },
    { key: "maker", priority: 2 },
    { key: "date", priority: 4 },
    { key: "material", priority: 6 },
    { key: "dimensions", priority: 5 },
    { key: "price", priority: 3 },
    { key: "description", priority: 7 },
    // The house's own columns, after everything the catalogue names and only
    // while there is room. A column they asked to keep and then never saw again
    // would be a column discarded with extra steps.
    { key: "*" },
  ],
} satisfies TemplateInput);

/**
 * A price list — the sheet at the desk, on the door and read down the phone.
 *
 * A TABLE, not a dense grid: every row carries the same columns whether or not
 * this lot has a maker, so a reader's eye can run down one column. The plate is
 * a thumbnail column. There is no `*`: a price list is its four columns, and
 * the house's provenance notes do not become a fifth. That is the template
 * saying so in data, which a house that wants a fifth column can change.
 */
export const PRICE_LIST: Template = templateSchema.parse({
  id: "price-list",
  name: { zh: "價目表", en: "Price list" },
  purpose: "One row per lot: reference, title, maker and estimate, with a small plate.",
  arrangement: "table",
  page: { size: "A4", orientation: "portrait", margin: 6 },
  type: { body: 0.95, cap: 11 },
  densities: [
    { perPage: 14, fields: 3, lines: 3, units: 330 },
    { perPage: 20, fields: 3, lines: 2, units: 220 },
    { perPage: 28, fields: 3, lines: 1, units: 110 },
  ],
  defaultPerPage: 20,
  plate: { beside: 0.1 },
  fields: [
    { key: "ref", width: 1.2 },
    { key: "title", priority: 1, width: 4 },
    { key: "maker", priority: 2, width: 2.4 },
    { key: "price", priority: 3, width: 2.4 },
  ],
} satisfies TemplateInput);

/**
 * A tearsheet — one lot to a page, the plate large, and everything the record
 * says about it. A gallery hands these out; an auction house sends one to a
 * client who asked about a single lot.
 *
 * A SHEET: not a one-up grid with bigger numbers. The caption is a description
 * list with the specifications labelled, the prose keeps its paragraphs, and
 * the budgets are wide enough that nothing is shortened — the whole description
 * is the point of the page.
 */
export const TEARSHEET: Template = templateSchema.parse({
  id: "tearsheet",
  name: { zh: "單張", en: "Tearsheet" },
  purpose: "One lot to a page — the plate large and the full description. A gallery's own hand-out.",
  arrangement: "sheet",
  page: { size: "A4", orientation: "portrait", margin: 7 },
  type: { body: 1.3, cap: 14 },
  densities: [{ perPage: 1, fields: 40, lines: 60, units: 6000 }],
  defaultPerPage: 1,
  plate: { above: 0.52, beside: 0.5 },
  fields: [
    { key: "ref" },
    { key: "title", priority: 1 },
    { key: "maker", priority: 2 },
    { key: "date", priority: 3 },
    { key: "material", priority: 5, label: true },
    { key: "dimensions", priority: 4, label: true },
    { key: "price", priority: 6, label: true },
    { key: "description", priority: 7 },
    // Labelled, because a reader cannot tell what "1965–1972" is without the
    // house's own column name beside it.
    { key: "*", label: true },
  ],
} satisfies TemplateInput);

/**
 * A condition report — one lot to a page: who looked, under what light, what
 * they found, numbered.
 *
 * ── WHY IT IS A TEMPLATE AT ALL ─────────────────────────────────────────────
 *
 * Because principle 6 leaves no alternative. A report painted by a function of
 * its own would be a second renderer by another name, and the predecessor's
 * preview stopped resembling its deliverable in exactly that way. The report is
 * a sheet of (label, value) lines over a plate, which is a shape this
 * vocabulary already says; the record it is derived from is composed from the
 * examination rather than read from `lots.fields`
 * (src/lib/data/examinations.ts, `conditionReportLot`).
 *
 * The MARKS arrive as the house's own columns — `Mark front 1`, `Mark base 2` —
 * where `*` puts them, labelled, because the label is what numbers them on
 * paper. That is the same mechanism a house's own spreadsheet column prints
 * through, which is the point: no new vocabulary, no new switch in the
 * renderer.
 *
 * ── WHAT THIS TEMPLATE CANNOT SAY, AND WHY IT IS NOT WIDENED ────────────────
 *
 * THE ANNOTATED VIEW. The screen's whole idea is a photograph with numbered
 * rings standing where the faults are, and that cannot be expressed here: the
 * vocabulary has a plate, and a plate is one picture. Marks over it would need
 * a coordinate space inside a printed entry, which is the box-geometry language
 * this file rejected, and a renderer switch that is not a fourth ARRANGEMENT —
 * src/lib/render/html.ts says a fourth switch means a fourth arrangement of the
 * same entry, and "a picture with points on it" is not that. So the printed
 * report carries the reference view UNANNOTATED and the marks as numbered
 * prose, and the annotated view stays on the screen. Widening the renderer for
 * one output is how a house ends up with two.
 *
 * ── WHY IT IS NOT IN `BUILT_IN_TEMPLATES` ───────────────────────────────────
 *
 * That list is what a CATALOGUE may be laid out on, and the editor's template
 * control offers every member of it. A sale laid out as condition reports would
 * print a page per lot of fields no lot record has — a template offered where
 * it means nothing, which is worse than one that is hard to find. `derive`
 * takes its library as an argument for exactly this, and the report route
 * passes `REPORT_TEMPLATES`.
 */
export const CONDITION_REPORT: Template = templateSchema.parse({
  id: "condition-report",
  name: { zh: "狀況報告", en: "Condition report" },
  purpose:
    "One lot to a page: who examined it, under what light, and every mark in order.",
  arrangement: "sheet",
  page: { size: "A4", orientation: "portrait", margin: 7 },
  type: { body: 1.05, cap: 12 },
  // ONE DENSITY, and the budgets are wide on purpose. A report that dropped a
  // mark to fit a page would be a report that hides a fault — the one failure
  // this document cannot have. Sixty fields is the schema's ceiling and is nine
  // named lines plus fifty-one marks; a lot with more faults than that needs a
  // conservator, not a bigger budget.
  densities: [{ perPage: 1, fields: 60, lines: 200, units: 20_000 }],
  defaultPerPage: 1,
  // Smaller than a tearsheet's plate: the picture is here to say which object
  // this is, and the page belongs to the prose.
  plate: { above: 0.38 },
  fields: [
    { key: "ref" },
    { key: "title", priority: 1 },
    { key: "maker", priority: 2 },
    // Labelled, every one: a bare date and a bare name in a column would leave
    // a reader guessing which was the examiner and which the custodian.
    { key: "Examined", priority: 3, label: true },
    { key: "Examiner", priority: 4, label: true },
    { key: "Light", priority: 5, label: true },
    { key: "Occasion", priority: 6, label: true },
    { key: "Summary", priority: 7 },
    // The marks, labelled — the label is what numbers them and names their
    // view, because on paper there is no switcher to say which view is
    // showing. They print after the overall reading and before the appendix,
    // which is where a registrar looks for them.
    { key: "*", priority: 8, label: true },
    // The public half of the custody chain, as the catalogue would print it.
    // The one place in this phase where the print path reads the movement
    // table, and it reads it through the same function the movement screen
    // shows (src/lib/data/movements.ts, `provenanceText`). LAST in print order
    // and last to survive a short page: it is context, and a condition report
    // that dropped a mark to keep a provenance line would be the wrong
    // document.
    { key: "Provenance", priority: 9, label: true },
  ],
} satisfies TemplateInput);

export const BUILT_IN_TEMPLATES: readonly Template[] = [CATALOGUE, PRICE_LIST, TEARSHEET];

/**
 * Templates that are not catalogues.
 *
 * A separate library rather than a flag on the template, because `derive`
 * already takes the library as an argument and a flag would mean every caller
 * of `templateFor` learning to filter. Passed by the route that prints a
 * report; `BUILT_IN_TEMPLATES` stays the answer to "what may this catalogue
 * look like".
 */
export const REPORT_TEMPLATES: readonly Template[] = [CONDITION_REPORT];

export const DEFAULT_TEMPLATE_ID = CATALOGUE.id;

/**
 * The template an id names, or the catalogue.
 *
 * TOTAL over anything jsonb can hold, because `catalogues.params` is jsonb and
 * a row written before templates existed has no `template` at all. Such a row
 * is a catalogue — it always was — and this is what makes that true without a
 * migration.
 */
export function templateFor(
  id: unknown,
  library: readonly Template[] = BUILT_IN_TEMPLATES,
): Template {
  const named = typeof id === "string" ? library.find((t) => t.id === id) : undefined;
  return named ?? library.find((t) => t.id === DEFAULT_TEMPLATE_ID) ?? library[0] ?? CATALOGUE;
}

/** The density a template offers at `perPage`, or its default when it does not. */
export function densityFor(template: Template, perPage: unknown): Density {
  const wanted =
    typeof perPage === "number"
      ? template.densities.find((d) => d.perPage === perPage)
      : undefined;
  return wanted ?? template.densities.find((d) => d.perPage === template.defaultPerPage)!;
}

/**
 * The placement a template offers nearest to what was asked for.
 *
 * `above` when offered, otherwise `beside`. A template with no plate still
 * answers `above`, so that a stored parameter survives a change of template
 * and back rather than being rewritten by a template it meant nothing to.
 */
export function placementFor(template: Template, wanted: unknown): Placement {
  const plate = template.plate;
  if (!plate) return "above";
  if (wanted === "beside" && plate.beside !== undefined) return "beside";
  if (wanted === "above" && plate.above !== undefined) return "above";
  return plate.above !== undefined ? "above" : "beside";
}

/** The placements a template actually offers, for a control to list. */
export function placementsOf(template: Template): Placement[] {
  const out: Placement[] = [];
  if (template.plate?.above !== undefined) out.push("above");
  if (template.plate?.beside !== undefined) out.push("beside");
  return out;
}

/**
 * What a control needs to offer a template: enough to list it and to know what
 * it accepts, and nothing the client bundle would need zod for.
 */
export interface TemplateChoice {
  id: string;
  name: { zh: string; en: string };
  purpose: string;
  arrangement: Arrangement;
  densities: number[];
  defaultPerPage: number;
  placements: Placement[];
}

export function templateChoice(template: Template): TemplateChoice {
  return {
    id: template.id,
    name: template.name,
    purpose: template.purpose,
    arrangement: template.arrangement,
    densities: template.densities.map((d) => d.perPage),
    defaultPerPage: template.defaultPerPage,
    placements: placementsOf(template),
  };
}
