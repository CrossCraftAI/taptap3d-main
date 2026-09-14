// Workflow: where a sale is in the operator's cycle, as data.
//
// ── WHY THIS IS NOT THE RAIL ────────────────────────────────────────────────
//
// The rail shipped as Record · Capture · Compose · Publish · Move · Connect ·
// Admin, and the owner rejected it, rightly. The first four were a SEQUENCE and
// the last three were capabilities, filed together in one vertical menu. A menu
// throws away the order, and a list of capabilities with four items secretly in
// order misleads. We had built a pipeline and filed it as a menu.
//
// A progress bar across the top was considered and rejected too. It costs every
// editor screen vertical space to say something about ONE sale, when the person
// who needs the answer is comparing sixty of them. So progress lives where a
// specialist compares sales — the ledger — as a COLUMN, with a call to action
// that changes with it. This file is what that column reads.
//
// ── A CYCLE, NOT A PIPELINE ─────────────────────────────────────────────────
//
// DFD.md §1: "a system that models it as a one-way funnel will have nowhere to
// put the lot that fails to sell." So the stage REPORTS; it never gates. Nothing
// here is consulted before a screen opens or a button works, nothing is greyed
// out because of it, and nothing below may be turned into a guard. A stage is a
// reading of the facts, the way a count is, and the sale that comes back round
// — more lots after the export, a re-issue — simply reads differently.
//
// ── DERIVED BY DEFAULT, PINNED BY EXCEPTION ─────────────────────────────────
//
// The stage is DERIVED from facts the system already holds — lots imported, lots
// photographed, a catalogue opened, an export taken — so a sale's row says where
// it is without anyone filing a status. That is ARCHITECTURE.md principle 3.
//
// And a person may set it, and their answer wins and is remembered: principle 9,
// a default and not a lock. A house that never photographs its paper lots sets a
// sale to Catalogued and it stays there through the next import. Reverting to
// the derived answer is one option in the same control, because an automatic
// value a human cannot reach — or cannot get back to — is a defect. The stored
// answer is one nullable column on `events`; null means "as the data says".
//
// ── WHY DATA, AND WHY ONE BUILT-IN ──────────────────────────────────────────
//
// SOPs differ enormously between an auction house, a gallery and a museum — the
// owner has said so explicitly. So a workflow is a validated DECLARATION in the
// shape templates.ts established: a zod schema, built-in constants, an id on the
// row where a choice is stored, and a table only when there is a writer. The
// ledger, the call to action and the event page read WHATEVER workflow they are
// handed; none of them knows the built-in's stage names. A house-authored
// workflow is a jsonb row passed through `workflowSchema`, and nothing above it
// changes shape.
//
// Rejected: a `workflows` table. DFD.md §2 — "named only" must not become an
// empty table shipped in advance; nobody authors one inside the system yet.
// Rejected: stage rules as functions. A function cannot be stored, validated or
// written by a house, and would ship with the code. The rule vocabulary below
// is small on purpose: a fact, and how much of it.
// Rejected: reading the stage from the action log. The log is the instrument
// (principle 5), not a feature, and a stage read from gestures would say what
// somebody DID rather than what is TRUE of the sale.

import { z } from "zod";

// ── The facts ───────────────────────────────────────────────────────────────

/**
 * What a stage may be read from. CLOSED, and each is a number `listEvents`
 * already counts. A fact joins this list the day a table records it (DFD.md
 * §2: a condition report, a warehouse location) — never before, because a rule
 * about a fact nobody records is a rule that is always false.
 */
export const FACTS = ["lots", "photographed", "catalogues", "exported"] as const;
export type Fact = (typeof FACTS)[number];

/** Facts counted PER LOT, so "all" means "as many as there are lots". */
const PER_LOT: readonly Fact[] = ["photographed"];

export type StageFacts = Record<Fact, number>;

// ── The places ──────────────────────────────────────────────────────────────

/**
 * Where a call to action may send someone: the screens this system has, by
 * name rather than by URL, so a workflow cannot point at a page that does not
 * exist. A menu item that 404s in front of a customer is the worst outcome a
 * reorganisation can have, and a house-authored workflow must not be able to
 * produce one. A new screen joins this list when it lands.
 */
export const PLACES = ["event", "import", "photographs", "catalogue", "pdf"] as const;
export type Place = (typeof PLACES)[number];

/** Every URL a place can resolve to, spelled so `<Link>` type-checks it. */
export type PlaceHref =
  | `/events/${string}`
  | `/events/${string}/import`
  | `/events/${string}/catalogue`
  | `/events/${string}/catalogue/pdf`
  | "/photographs";

export function placeHref(place: Place, eventId: string): PlaceHref {
  switch (place) {
    case "event":
      return `/events/${eventId}`;
    case "import":
      return `/events/${eventId}/import`;
    case "photographs":
      // The library, not a filter of it: photographs for a sale arrive there
      // whether or not any are waiting to be filed, and the whole window is the
      // drop target.
      return "/photographs";
    case "catalogue":
      return `/events/${eventId}/catalogue`;
    case "pdf":
      return `/events/${eventId}/catalogue/pdf`;
  }
}

/**
 * Whether a place answers with a FILE rather than a page. The PDF is a stream of
 * bytes with its own content-type, and a client-side navigation has nowhere to
 * put it — so the component renders a plain anchor, not a `<Link>`.
 */
export function placeIsFile(place: Place): boolean {
  return place === "pdf";
}

// ── The schema ──────────────────────────────────────────────────────────────

const slug = z.string().regex(/^[a-z][a-z0-9-]{1,40}$/);
/** Bilingual, because the first customers work in Traditional Chinese. */
const bilingual = z.object({ zh: z.string().min(1).max(40), en: z.string().min(1).max(40) });

/**
 * One thing that must be true of the facts.
 *
 * `atLeast` is a floor. A number is a count; `"all"` is every lot, and holds
 * only when there are lots — a sale with none has not photographed all of them.
 */
export const conditionSchema = z.object({
  fact: z.enum(FACTS),
  atLeast: z.union([z.number().int().min(1), z.literal("all")]).default(1),
});

export const stageSchema = z.object({
  id: slug,
  /** The sale's state, as a column reads it: Recorded, Photographed. */
  label: bilingual,
  /**
   * Satisfied when EVERY condition holds. Absent on the first stage only: that
   * is where a sale begins, and it needs no evidence to be there.
   */
  when: z.array(conditionSchema).min(1).max(8).optional(),
  /** What a person does from here. A button, wherever the stage is shown. */
  next: z.object({ label: bilingual, to: z.enum(PLACES) }),
});

export const workflowSchema = z
  .object({
    id: slug,
    name: bilingual,
    /** In order. The order IS the workflow; nothing else about it is. */
    stages: z.array(stageSchema).min(2).max(12),
  })
  .superRefine((workflow, ctx) => {
    const issue = (message: string, path: (string | number)[]): void => {
      ctx.addIssue({ code: "custom", message, path });
    };

    const ids = workflow.stages.map((s) => s.id);
    if (new Set(ids).size !== ids.length) {
      issue("each stage may be declared once", ["stages"]);
    }

    workflow.stages.forEach((stage, index) => {
      const path = ["stages", index];
      if (index === 0 && stage.when !== undefined) {
        issue("the first stage is where a sale begins; it has nothing to satisfy", [...path, "when"]);
      }
      if (index > 0 && stage.when === undefined) {
        issue("a stage after the first must say what makes a sale reach it", [...path, "when"]);
      }
      stage.when?.forEach((condition, c) => {
        if (condition.atLeast === "all" && !PER_LOT.includes(condition.fact)) {
          issue(
            `"all" means every lot, and ${condition.fact} is not counted per lot`,
            [...path, "when", c, "atLeast"],
          );
        }
      });
    });
  });

export type Workflow = z.infer<typeof workflowSchema>;
export type WorkflowInput = z.input<typeof workflowSchema>;
export type Stage = z.infer<typeof stageSchema>;
export type Condition = z.infer<typeof conditionSchema>;

// ── The built-in ────────────────────────────────────────────────────────────
//
// Parsed at module load, so a wrong shape here fails the first test and the
// build rather than the ledger.

/**
 * Catalogue production, as an auction house does it.
 *
 * Five states, four steps between them. "Photographed" means EVERY lot: a sale
 * with nine plates out of ten is still being photographed, and the column
 * beside it says nine of ten. A house whose paper lots never get a plate sets
 * the sale on by hand — which is exactly what the override is for.
 *
 * The last stage's action is the same as the one before it, on purpose. After
 * the export the cycle leaves this system — showcase, sale, the next
 * consignment (DFD.md §1) — and the one thing a person still does here is send
 * the file to the printer again.
 */
export const CATALOGUE_PRODUCTION: Workflow = workflowSchema.parse({
  id: "catalogue-production",
  name: { zh: "圖錄製作", en: "Catalogue production" },
  stages: [
    {
      id: "new",
      label: { zh: "新建", en: "New" },
      next: { label: { zh: "匯入拍品", en: "Import lots" }, to: "import" },
    },
    {
      id: "recorded",
      label: { zh: "已記錄", en: "Recorded" },
      when: [{ fact: "lots", atLeast: 1 }],
      next: { label: { zh: "加入照片", en: "Add photographs" }, to: "photographs" },
    },
    {
      id: "photographed",
      label: { zh: "已攝影", en: "Photographed" },
      when: [{ fact: "photographed", atLeast: "all" }],
      next: { label: { zh: "開啟圖錄", en: "Open catalogue" }, to: "catalogue" },
    },
    {
      id: "catalogued",
      label: { zh: "已編錄", en: "Catalogued" },
      when: [{ fact: "catalogues", atLeast: 1 }],
      next: { label: { zh: "下載 PDF", en: "Download PDF" }, to: "pdf" },
    },
    {
      id: "exported",
      label: { zh: "已匯出", en: "Exported" },
      when: [{ fact: "exported", atLeast: 1 }],
      next: { label: { zh: "下載 PDF", en: "Download PDF" }, to: "pdf" },
    },
  ],
} satisfies WorkflowInput);

export const BUILT_IN_WORKFLOWS: readonly Workflow[] = [CATALOGUE_PRODUCTION];

export const DEFAULT_WORKFLOW_ID = CATALOGUE_PRODUCTION.id;

/**
 * The workflow an id names, or the built-in.
 *
 * TOTAL over anything a column can hold, the way `templateFor` is: no org
 * carries a workflow id yet, and the day one does, a row written before that
 * has none and is on the built-in — without a migration.
 */
export function workflowFor(
  id: unknown,
  library: readonly Workflow[] = BUILT_IN_WORKFLOWS,
): Workflow {
  const named = typeof id === "string" ? library.find((w) => w.id === id) : undefined;
  return named ?? library.find((w) => w.id === DEFAULT_WORKFLOW_ID) ?? library[0] ?? CATALOGUE_PRODUCTION;
}

// ── Derivation ──────────────────────────────────────────────────────────────

export function holds(condition: Condition, facts: StageFacts): boolean {
  const n = facts[condition.fact];
  if (condition.atLeast === "all") return facts.lots > 0 && n >= facts.lots;
  return n >= condition.atLeast;
}

/** Whether the facts satisfy this stage on its own terms. */
export function satisfies(stage: Stage, facts: StageFacts): boolean {
  return (stage.when ?? []).every((condition) => holds(condition, facts));
}

/**
 * The index of the stage the facts put a sale at.
 *
 * THE FURTHEST STAGE SATISFIED WITH EVERY STAGE BEFORE IT — not the furthest
 * satisfied on its own. The difference is one row: an event with no lots whose
 * catalogue somebody opened once has a `catalogues` row, and read stage by
 * stage it would be "Catalogued" with a button offering to print an empty
 * document (which the exports ledger deliberately refuses to offer). Read in
 * order, it is "New", and the button says to import lots.
 *
 * This is not a gate. The catalogue opened; the PDF prints; the reading simply
 * says what is still outstanding, which is what a progress column is for.
 *
 * PURE. Facts in, an index out, no database — so it is tested as a table of
 * cases in test/workflow.test.ts and cannot disagree between the ledger and
 * the event page, which both call it.
 */
export function deriveStageIndex(workflow: Workflow, facts: StageFacts): number {
  let reached = 0;
  for (let i = 1; i < workflow.stages.length; i++) {
    if (!satisfies(workflow.stages[i]!, facts)) break;
    reached = i;
  }
  return reached;
}

export interface StageReading {
  workflow: Workflow;
  /** The stage shown: the person's, if they set one, else the derived. */
  stage: Stage;
  index: number;
  /** What the facts say, whether or not it is what is shown. */
  derived: Stage;
  derivedIndex: number;
  /** True when a person's answer is standing in for the derived one. */
  overridden: boolean;
}

/**
 * Where a sale is, with a person's answer winning over the data's.
 *
 * TOTAL over anything the column can hold. An override naming a stage the
 * workflow does not have — the built-in was renamed, a house swapped its
 * workflow — is not an error; the derived stage stands and the reading says it
 * was not overridden, so the ledger never shows a name nobody can choose. The
 * stale value stays in the row until somebody sets or reverts it.
 *
 * An override EQUAL to the derived stage still counts as overridden: the person
 * said so, and their answer holds when the facts move on. That is what
 * "remembered" means.
 */
export function readStage(
  workflow: Workflow,
  facts: StageFacts,
  override: string | null | undefined,
): StageReading {
  const derivedIndex = deriveStageIndex(workflow, facts);
  const derived = workflow.stages[derivedIndex]!;
  const pinnedIndex =
    typeof override === "string" ? workflow.stages.findIndex((s) => s.id === override) : -1;
  if (pinnedIndex < 0) {
    return { workflow, stage: derived, index: derivedIndex, derived, derivedIndex, overridden: false };
  }
  return {
    workflow,
    stage: workflow.stages[pinnedIndex]!,
    index: pinnedIndex,
    derived,
    derivedIndex,
    overridden: true,
  };
}
