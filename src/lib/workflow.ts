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
        issue("the first stage is where an event begins; it has nothing to satisfy", [...path, "when"]);
      }
      if (index > 0 && stage.when === undefined) {
        issue("a stage after the first must say what makes an event reach it", [...path, "when"]);
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
  /**
   * The counts this reading was taken from.
   *
   * CARRIED, not asked for again. Everything a caller wants to say about a
   * reading — how far along it is, what the next stage is still waiting for —
   * is a question about these same numbers, and a second `facts` argument
   * beside a reading is two answers to "which sale?" that nothing checks are
   * the same one. `isMidJob` took one until this landed.
   */
  facts: StageFacts;
}

/**
 * Whether a person is MID-JOB on this sale, as against merely not finished.
 *
 * ── WHY THE LEDGER NEEDS THIS AND THE STAGE CANNOT GIVE IT ──────────────────
 *
 * Every sale short of the last stage has work outstanding, so "unfinished" is
 * not a signal — it is most of the list. The ledger paints its call to action
 * loud only where this is true, because an accent spent on sixty rows is no
 * accent (src/app/globals.css says the same about the token).
 *
 * The one thing a stage LABEL cannot say is how far through the current step a
 * sale is: a sale with one plate out of two hundred and a sale with a hundred
 * and ninety-nine both read "Recorded", and only one of them has somebody
 * standing over it. So: the next stage is reached by finishing something
 * counted PER LOT, and that count has started and has not finished. Nobody has
 * begun — quiet, it is a job to schedule. Somebody stopped halfway — loud, it
 * is a job to resume, and resuming is cheaper than starting.
 *
 * PER LOT is the same list the schema validates `"all"` against, so a fact
 * joins this the day it is counted per lot and not before. A condition with a
 * plain number floor is not a part-way job: `lots >= 1` is on or off.
 *
 * FALSE AT THE LAST STAGE, which is what "nothing is both finished and
 * waiting" means in code — there is no stage after it to be part-way toward.
 *
 * Reads the SHOWN stage, so a person who set the stage by hand moves the
 * question with it (principle 9). PURE, for the reason everything else here is.
 */
export function isMidJob(reading: StageReading): boolean {
  const next = reading.workflow.stages[reading.index + 1];
  if (!next) return false;
  const facts = reading.facts;
  return (next.when ?? []).some((condition) => {
    if (condition.atLeast !== "all" || !PER_LOT.includes(condition.fact)) return false;
    const done = facts[condition.fact];
    return done > 0 && done < facts.lots;
  });
}

/**
 * What the next stage is still waiting for, in words — the other half of the
 * stage cell.
 *
 * ── WHY THE LABEL NEEDS IT ──────────────────────────────────────────────────
 *
 * A stage name is a state and says nothing about how much of the current step
 * is left, so "Recorded" reads identically for a sale with one plate of two
 * hundred and one with a hundred and ninety-nine — which is the same defect
 * `isMidJob` exists for, told rather than painted. The drawing's cell was
 * "Receive · 87 without a condition check"; the product's was "Recorded", and
 * the quantifier had been moved two columns away into the lot counts, where it
 * is about the inventory rather than about the step.
 *
 * ── WHY IT IS DERIVED AND NOT FIVE SENTENCES ────────────────────────────────
 *
 * A sentence per stage would work for the built-in and for nothing else: a
 * house authors its own stages (see the note at the top of this file), and the
 * day it does, a hard-coded phrase either names a stage that no longer exists
 * or says nothing at all. So the shortfall is read from the next stage's own
 * `when` conditions against the facts — the same two inputs `deriveStageIndex`
 * uses, so the cell cannot disagree with the indicator beside it.
 *
 * THIS IS POSSIBLE ONLY BECAUSE THE FACTS ARE A CLOSED SET. `FACTS` is four
 * names, the schema refuses any other, and a house-authored workflow can
 * therefore only ever ask for a quantity of something this file already knows
 * the noun for. The conditions are the house's; the nouns are ours. A fact
 * joining `FACTS` joins `FACT_NOUN` in the same commit, and the test walks the
 * two lists against each other so it cannot be forgotten.
 *
 * Rejected: a phrase authored on the condition itself (`when: [{ fact,
 * atLeast, lacking }]`). It would have to be optional — no existing workflow
 * carries one — so the house that omits it gets the bare stage name back and
 * the defect returns for exactly the workflows this exists to serve. It would
 * also put a user-facing sentence into stored data, where the vocabulary layer
 * (Phase 10, deferred) cannot reach it.
 *
 * Null where there is nothing to say: at the last stage, because nothing is
 * both finished and waiting; and when the next stage's conditions already hold,
 * which is what a person setting a sale BACK by hand looks like.
 *
 * PURE, and English only — the same half of the bilingual pair the cell renders
 * beside it (`stage.label.en`). A `zh` half here would be a string no screen
 * reads and no test can hold to account, which is the kind of speculative
 * second vocabulary ARCHITECTURE.md's closing list refuses; it arrives when the
 * interface picks a language, and it arrives for the whole interface at once.
 */
export function shortfallOf(reading: StageReading): string | null {
  const next = reading.workflow.stages[reading.index + 1];
  if (!next) return null;
  const unmet = (next.when ?? []).filter((c) => !holds(c, reading.facts));
  if (unmet.length === 0) return null;
  // Every one of them, in the order the workflow declares them: a stage that
  // waits on two things is not half-described by the first. The built-in never
  // declares more than one, so this is the house-authored case being kept
  // whole rather than a shape the shipped ledger draws.
  return unmet.map((c) => lacking(c, reading.facts)).join(", ");
}

/**
 * What each fact is called when a label has to name what is missing.
 *
 * Two voices, because a shortfall is said two ways: "no photographs yet" counts
 * the fact, and "87 without a photograph" counts the LOTS that lack one. Both
 * nouns are the schema's, not an auction house's — the word a tenant sees for
 * its own objects is the vocabulary layer's job (Phase 10), and hard-coding one
 * house's word here would be work that layer has to undo first.
 */
const FACT_NOUN: Record<Fact, { one: string; many: string }> = {
  lots: { one: "lot", many: "lots" },
  photographed: { one: "photograph", many: "photographs" },
  catalogues: { one: "catalogue", many: "catalogues" },
  exported: { one: "export", many: "exports" },
};

/** One unmet condition, as the shortfall it describes. */
function lacking(condition: Condition, facts: StageFacts): string {
  const noun = FACT_NOUN[condition.fact];
  const have = facts[condition.fact];

  if (condition.atLeast === "all") {
    // "all" is per-lot — the schema refuses it on any other fact — so what is
    // outstanding is the lots without it, which is the drawing's phrasing.
    // With no lots there is nothing to be short OF: the sale needs lots first,
    // and saying "0 without a photograph" of an empty sale would be a sentence
    // that is true and useless.
    return facts.lots === 0
      ? `no ${FACT_NOUN.lots.many} yet`
      : `${facts.lots - have} without a ${noun.one}`;
  }

  // A floor. Nothing yet is the common case and reads better as a state than
  // as arithmetic; past that it is how many more.
  if (have === 0) return `no ${noun.many} yet`;
  const short = condition.atLeast - have;
  return `${short} more ${short === 1 ? noun.one : noun.many}`;
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
    return { workflow, stage: derived, index: derivedIndex, derived, derivedIndex, overridden: false, facts };
  }
  return {
    workflow,
    stage: workflow.stages[pinnedIndex]!,
    index: pinnedIndex,
    derived,
    derivedIndex,
    overridden: true,
    facts,
  };
}
