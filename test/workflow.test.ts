// Workflow as data — the vocabulary, the one built-in, and the reading.
//
// The table of facts → stage is the whole contract between the ledger and the
// event page: both call `readStage` on the same numbers, and this is where the
// one decision that is easy to undo in good faith is held — that a stage counts
// only WITH EVERY STAGE BEFORE IT, so an empty sale whose catalogue was opened
// once reads as New and not as Catalogued. The rest holds the vocabulary to its
// refusals, proves a person's answer wins and can be taken back, and reads a
// workflow the built-in knows nothing about, because a gallery's will be one.
//
// The shortfall — the half of the stage cell that says what the next stage is
// still waiting for — is held to the same standard: every case below is read
// from a workflow's own conditions, and three of them are read from workflows
// the built-in could not have anticipated.

import { existsSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  BUILT_IN_WORKFLOWS,
  CATALOGUE_PRODUCTION,
  FACTS,
  PLACES,
  deriveStageIndex,
  isMidJob,
  placeHref,
  placeIsFile,
  readStage,
  shortfallOf,
  workflowFor,
  workflowSchema,
  type Place,
  type StageFacts,
  type WorkflowInput,
} from "@/lib/workflow";

const ROOT = path.resolve(import.meta.dirname, "..");

const facts = (
  lots = 0,
  photographed = 0,
  catalogues = 0,
  exported = 0,
): StageFacts => ({ lots, photographed, catalogues, exported });

const W = CATALOGUE_PRODUCTION;

describe("the built-in workflow", () => {
  it("is valid data — parsed at load, so this is a second opinion", () => {
    expect(workflowSchema.safeParse(W).success).toBe(true);
    expect(BUILT_IN_WORKFLOWS).toContain(W);
  });

  it("begins with a stage that needs no evidence", () => {
    expect(W.stages[0]!.when).toBeUndefined();
    for (const stage of W.stages.slice(1)) expect(stage.when).toBeDefined();
  });

  it("is what any id resolves to until a house authors another", () => {
    expect(workflowFor(undefined)).toBe(W);
    expect(workflowFor(null)).toBe(W);
    expect(workflowFor("no-such-workflow")).toBe(W);
    expect(workflowFor(42)).toBe(W);
    expect(workflowFor(W.id)).toBe(W);
  });
});

describe("what the vocabulary refuses", () => {
  // A minimal valid workflow to break one thing at a time.
  const base: WorkflowInput = {
    id: "two-step",
    name: { zh: "兩步", en: "Two steps" },
    stages: [
      // IDS OF TWO CHARACTERS OR MORE, because the slug rule asks for them —
      // and because a one-character id made the duplicate-id case below pass
      // for the wrong reason: it was refused for its length before anything
      // looked at whether the id was already taken.
      { id: "one", label: { zh: "甲", en: "A" }, next: { label: { zh: "去", en: "Go" }, to: "import" } },
      {
        id: "two",
        label: { zh: "乙", en: "B" },
        when: [{ fact: "lots", atLeast: 1 }],
        next: { label: { zh: "印", en: "Print" }, to: "pdf" },
      },
    ],
  };
  const stage = (i: number) => structuredClone(base.stages[i]!);

  it("accepts the base, so the refusals below are about the change", () => {
    expect(workflowSchema.safeParse(base).success).toBe(true);
  });

  it.each<[string, WorkflowInput]>([
    [
      "a first stage with something to satisfy",
      { ...base, stages: [{ ...stage(0), when: [{ fact: "lots" }] }, stage(1)] },
    ],
    [
      "a later stage with nothing to satisfy",
      { ...base, stages: [stage(0), { ...stage(1), when: undefined }] },
    ],
    ["two stages with one id", { ...base, stages: [stage(0), { ...stage(1), id: "one" }] }],
    [
      '"all" of a fact that is not counted per lot',
      { ...base, stages: [stage(0), { ...stage(1), when: [{ fact: "catalogues", atLeast: "all" }] }] },
    ],
    [
      "an action pointing somewhere this system has no screen for",
      {
        ...base,
        stages: [stage(0), { ...stage(1), next: { label: { zh: "倉", en: "Warehouse" }, to: "warehouse" as Place } }],
      },
    ],
    [
      "a fact nothing records",
      { ...base, stages: [stage(0), { ...stage(1), when: [{ fact: "condition" as "lots" }] }] },
    ],
    ["a floor of zero, which every sale clears", {
      ...base,
      stages: [stage(0), { ...stage(1), when: [{ fact: "lots", atLeast: 0 }] }],
    }],
    ["one stage, which is a label and not a workflow", { ...base, stages: [stage(0)] }],
  ])("refuses %s", (_what, input) => {
    expect(workflowSchema.safeParse(input).success).toBe(false);
  });

  it("defaults a condition's floor to one", () => {
    const parsed = workflowSchema.parse({
      ...base,
      stages: [stage(0), { ...stage(1), when: [{ fact: "exported" }] }],
    });
    expect(parsed.stages[1]!.when).toEqual([{ fact: "exported", atLeast: 1 }]);
  });
});

describe("where the facts put a sale", () => {
  it.each<[string, StageFacts, string, Place]>([
    ["nothing yet", facts(), "new", "import"],
    ["lots, no photographs", facts(10), "recorded", "photographs"],
    ["lots, some photographs", facts(10, 4), "recorded", "photographs"],
    ["every lot photographed", facts(10, 10), "photographed", "catalogue"],
    ["and a catalogue opened", facts(10, 10, 1), "catalogued", "pdf"],
    ["and the PDF taken", facts(10, 10, 1, 1), "exported", "pdf"],
    ["a single lot with its plate", facts(1, 1), "photographed", "catalogue"],
    // THE CASE THAT DECIDES THE READING RULE. Somebody opened the catalogue of
    // an empty sale, so a `catalogues` row exists. Read stage by stage on its
    // own terms this would be Catalogued, with a button offering to print an
    // empty document — which the exports ledger deliberately does not offer.
    // Read in order it is New, and the button says to import lots.
    ["a catalogue opened on an empty sale", facts(0, 0, 1), "new", "import"],
    // THE CYCLE COMING ROUND. The PDF went out; then a second consignment
    // arrived without plates. Nothing is gated — the PDF still prints — but
    // the reading says what is outstanding, which is what a progress column is
    // for.
    ["exported, then more lots arrived unphotographed", facts(10, 4, 1, 1), "recorded", "photographs"],
  ])("%s → %s", (_what, f, stageId, to) => {
    const reading = readStage(W, f, null);
    expect(reading.stage.id).toBe(stageId);
    expect(reading.stage.next.to).toBe(to);
    expect(reading.overridden).toBe(false);
    expect(reading.derived).toBe(reading.stage);
    expect(reading.index).toBe(deriveStageIndex(W, f));
  });

  it("is pure: the same facts read the same twice, and reading changes nothing", () => {
    const f = facts(10, 4, 1, 0);
    const before = structuredClone(f);
    expect(readStage(W, f, null)).toEqual(readStage(W, f, null));
    expect(f).toEqual(before);
  });
});

describe("whether somebody is part-way through", () => {
  // What the ledger paints its call to action loud for. The point of it is
  // that it says something the stage LABEL cannot: "Recorded" reads the same
  // at 1 plate of 200 as at 199, and only one of those is a job to resume.
  const mid = (f: StageFacts, override: string | null = null): boolean =>
    isMidJob(readStage(W, f, override));

  it.each<[string, StageFacts, boolean]>([
    ["nothing at all", facts(), false],
    // The next stage wants lots, which is a floor and not a per-lot count:
    // there is no such thing as being half-way to having one lot.
    ["lots in, no plates yet — a job to schedule", facts(10), false],
    ["four plates of ten — a job to resume", facts(10, 4), true],
    ["nine of ten", facts(10, 9), true],
    ["all ten", facts(10, 10), false],
    ["the one lot photographed", facts(1, 1), false],
    // Catalogued: the next stage wants an export, which is not per lot.
    ["a catalogue opened", facts(10, 10, 1), false],
    ["printed — there is no stage after it", facts(10, 10, 1, 1), false],
  ])("%s", (_what, f, expected) => {
    expect(mid(f)).toBe(expected);
  });

  it("moves with a person's answer, not with the data", () => {
    // The data says four of ten and would read loud. The person put the sale
    // at Catalogued, so the question is asked of THAT stage — and nothing
    // per-lot stands between it and the end.
    expect(mid(facts(10, 4))).toBe(true);
    expect(mid(facts(10, 4), "catalogued")).toBe(false);
    // And back the other way: a sale the data has finished, sent back by hand
    // to a stage there is per-lot work outstanding at.
    expect(mid(facts(10, 4, 1, 1), "recorded")).toBe(true);
  });

  it("is false for a workflow with no per-lot stage at all", () => {
    // A gallery does not photograph every work, so nothing in its cycle is
    // counted per lot and nothing of its is ever half done. The ledger is
    // quiet throughout, which is correct rather than a missing feature.
    const gallery = workflowSchema.parse({
      id: "gallery-show",
      name: { zh: "畫廊展覽", en: "Gallery show" },
      stages: [
        { id: "planned", label: { zh: "籌備中", en: "Planned" }, next: { label: { zh: "匯入", en: "Import" }, to: "import" } },
        { id: "hung", label: { zh: "已佈展", en: "Hung" }, when: [{ fact: "lots", atLeast: 1 }], next: { label: { zh: "單張", en: "Tearsheets" }, to: "catalogue" } },
      ],
    } satisfies WorkflowInput);
    for (const f of [facts(), facts(10), facts(10, 4)]) {
      expect(isMidJob(readStage(gallery, f, null))).toBe(false);
    }
  });
});

describe("what the next stage is still waiting for", () => {
  // The other half of the stage cell. A stage NAME is a state, so "Recorded"
  // reads identically at 1 plate of 200 and at 199 — the drawing's cell was
  // "Receive · 87 without a condition check" and the product's was "Recorded".
  // This is that quantifier, derived from the next stage's own conditions so
  // that a house-authored workflow gets one too.
  const short = (f: StageFacts, override: string | null = null): string | null =>
    shortfallOf(readStage(W, f, override));

  it.each<[string, StageFacts, string | null]>([
    ["nothing at all", facts(), "no lots yet"],
    ["lots in, not one plate", facts(10), "10 without a photograph"],
    ["four plates of ten", facts(10, 4), "6 without a photograph"],
    // The two readings the bare label could not tell apart, told apart.
    ["one of two hundred", facts(200, 1), "199 without a photograph"],
    ["a hundred and ninety-nine of two hundred", facts(200, 199), "1 without a photograph"],
    ["every plate taken", facts(10, 10), "no catalogues yet"],
    ["a catalogue opened", facts(10, 10, 1), "no exports yet"],
    // Nothing is both finished and waiting: there is no stage after the last.
    ["printed", facts(10, 10, 1, 1), null],
  ])("%s", (_what, f, expected) => {
    expect(short(f)).toBe(expected);
  });

  it("follows the shown stage, not the data's", () => {
    // The person put a half-photographed sale at Catalogued; what is
    // outstanding is what stands between THAT stage and the next one.
    expect(short(facts(10, 4), "catalogued")).toBe("no exports yet");
  });

  it("says nothing when the next stage is already satisfied", () => {
    // A printed sale sent back to New by hand. The step to Recorded wants
    // lots, and there are ten — so there is nothing outstanding to say, even
    // though the sale is not at the end of the workflow.
    expect(short(facts(10, 10, 1, 1), "new")).toBeNull();
  });

  it("has a noun for every fact a workflow may name", () => {
    // FACTS is closed and the schema refuses anything else, which is the whole
    // reason this can be derived rather than written as a sentence per stage.
    // Walked here so that a fact added without its noun fails loudly rather
    // than printing "no undefined yet" in a column.
    for (const fact of FACTS) {
      const w = workflowSchema.parse({
        id: "one-fact",
        name: { zh: "一項", en: "One fact" },
        stages: [
          { id: "start", label: { zh: "始", en: "Start" }, next: { label: { zh: "去", en: "Go" }, to: "import" } },
          {
            id: "done",
            label: { zh: "終", en: "Done" },
            when: [{ fact, atLeast: 1 }],
            next: { label: { zh: "印", en: "Print" }, to: "pdf" },
          },
        ],
      } satisfies WorkflowInput);
      const said = shortfallOf(readStage(w, facts(), null));
      expect(said, fact).toMatch(/^no [a-z]+ yet$/);
      // "no undefined yet" matches that pattern too, and is what a fact
      // without a noun would print if the lookup were ever made lenient.
      expect(said, fact).not.toContain("undefined");
    }
  });

  it("counts up to a floor above one, and says every unmet condition", () => {
    // Neither shape occurs in the built-in — it has one condition a stage and
    // every floor is one — and both are authorable, so both are held here.
    const strict = workflowSchema.parse({
      id: "strict-house",
      name: { zh: "嚴格", en: "Strict house" },
      stages: [
        { id: "start", label: { zh: "始", en: "Start" }, next: { label: { zh: "匯入", en: "Import" }, to: "import" } },
        {
          id: "ready",
          label: { zh: "就緒", en: "Ready" },
          when: [
            { fact: "lots", atLeast: 12 },
            { fact: "photographed", atLeast: "all" },
          ],
          next: { label: { zh: "印", en: "Print" }, to: "pdf" },
        },
      ],
    } satisfies WorkflowInput);

    expect(shortfallOf(readStage(strict, facts(10, 10), null))).toBe("2 more lots");
    expect(shortfallOf(readStage(strict, facts(10, 4), null))).toBe(
      "2 more lots, 6 without a photograph",
    );
    expect(shortfallOf(readStage(strict, facts(1), null))).toBe(
      "11 more lots, 1 without a photograph",
    );
  });

  it("asks for lots before plates when there are no lots to photograph", () => {
    // "all" of nothing is not a shortfall of photographs — the sale needs lots
    // first, and "0 without a photograph" would be true and useless. A house
    // can put a per-lot stage first; the built-in cannot.
    const gallery = workflowSchema.parse({
      id: "plates-first",
      name: { zh: "先攝影", en: "Plates first" },
      stages: [
        { id: "planned", label: { zh: "籌備", en: "Planned" }, next: { label: { zh: "匯入", en: "Import" }, to: "import" } },
        {
          id: "shot",
          label: { zh: "已攝影", en: "Shot" },
          when: [{ fact: "photographed", atLeast: "all" }],
          next: { label: { zh: "單張", en: "Tearsheets" }, to: "catalogue" },
        },
      ],
    } satisfies WorkflowInput);
    expect(shortfallOf(readStage(gallery, facts(), null))).toBe("no lots yet");
    expect(shortfallOf(readStage(gallery, facts(4, 1), null))).toBe("3 without a photograph");
  });

  it("is the reading's own, so nothing has to hand it the facts twice", () => {
    // The reading carries the counts it was taken from. Two arguments — a
    // reading and a `StageFacts` — would be two answers to "which sale?" that
    // nothing checks are the same one.
    const f: StageFacts = facts(10, 4);
    expect(readStage(W, f, null).facts).toEqual(f);
    expect(readStage(W, f, "catalogued").facts).toEqual(f);
  });
});

describe("a person's answer", () => {
  it("wins over the data, and the reading says so", () => {
    const reading = readStage(W, facts(10, 4), "catalogued");
    expect(reading.stage.id).toBe("catalogued");
    expect(reading.index).toBe(3);
    expect(reading.overridden).toBe(true);
    // What the data would have said is still there, for the hover and the
    // control — principle 9 says the automatic value stays visible.
    expect(reading.derived.id).toBe("recorded");
    expect(reading.derivedIndex).toBe(1);
    // And the action follows the person.
    expect(reading.stage.next.to).toBe("pdf");
  });

  it("is remembered even when it agrees with the data", () => {
    // The person said so; when the facts move on, their answer holds.
    const reading = readStage(W, facts(10), "recorded");
    expect(reading.stage.id).toBe("recorded");
    expect(reading.overridden).toBe(true);
  });

  it("is taken back with null, and the data speaks again", () => {
    const reading = readStage(W, facts(10, 4), null);
    expect(reading.stage.id).toBe("recorded");
    expect(reading.overridden).toBe(false);
  });

  it("that names a stage the workflow does not have falls back to the data", () => {
    // A renamed built-in, a house that swapped workflows: the stored id is
    // stale, not an error. The ledger never shows a name nobody can choose.
    for (const stale of ["shipped", "", "NEW"]) {
      const reading = readStage(W, facts(10, 4), stale);
      expect(reading.stage.id).toBe("recorded");
      expect(reading.overridden).toBe(false);
    }
  });
});

describe("a house-authored workflow", () => {
  // A gallery's: no photograph stage at all, tearsheets rather than a
  // catalogue, and its own names. Built as a plain object — the way a jsonb row
  // would arrive — and read by the same function, to show that nothing about
  // the built-in is assumed anywhere in the reading.
  const gallery = workflowSchema.parse({
    id: "gallery-show",
    name: { zh: "畫廊展覽", en: "Gallery show" },
    stages: [
      {
        id: "planned",
        label: { zh: "籌備中", en: "Planned" },
        next: { label: { zh: "匯入作品", en: "Import works" }, to: "import" },
      },
      {
        id: "hung",
        label: { zh: "已佈展", en: "Hung" },
        when: [{ fact: "lots", atLeast: 1 }],
        next: { label: { zh: "開啟單張", en: "Open tearsheets" }, to: "catalogue" },
      },
      {
        id: "printed",
        label: { zh: "已印製", en: "Printed" },
        when: [{ fact: "exported" }],
        next: { label: { zh: "再次下載", en: "Download again" }, to: "pdf" },
      },
    ],
  } satisfies WorkflowInput);

  it("reads with the same function, in its own words", () => {
    expect(readStage(gallery, facts(), null).stage.label.en).toBe("Planned");
    // No photograph stage, so plates do not matter to a gallery's reading.
    expect(readStage(gallery, facts(5, 0, 1, 0), null).stage.id).toBe("hung");
    expect(readStage(gallery, facts(5, 0, 1, 1), null).stage.id).toBe("printed");
    expect(readStage(gallery, facts(5), "printed").overridden).toBe(true);
  });

  it("has as many steps as it declares — the indicator counts them, not the built-in's", () => {
    expect(gallery.stages.length - 1).toBe(2);
    expect(readStage(gallery, facts(5, 0, 1, 1), null).index).toBe(2);
  });
});

describe("places", () => {
  // The rail's test walks its items for a page behind each; this walks the
  // places a workflow may point at, for the same reason. A house-authored
  // workflow can only name these, so a menu item that 404s cannot be authored.
  const FILE_OF: Record<Place, string> = {
    event: "src/app/events/[id]/page.tsx",
    import: "src/app/events/[id]/import/page.tsx",
    photographs: "src/app/photographs/page.tsx",
    catalogue: "src/app/events/[id]/catalogue/page.tsx",
    pdf: "src/app/events/[id]/catalogue/pdf/route.ts",
  };

  it.each(PLACES)("%s has a screen behind it", (place) => {
    expect(existsSync(path.join(ROOT, FILE_OF[place]))).toBe(true);
  });

  it.each(PLACES)("%s resolves to a URL of this system", (place) => {
    const href = placeHref(place, "abc-123");
    expect(href.startsWith("/")).toBe(true);
    // Every place but the library is the event's own.
    if (place !== "photographs") expect(href).toContain("/events/abc-123");
  });

  it("knows which answer is a file rather than a page", () => {
    expect(PLACES.filter(placeIsFile)).toEqual(["pdf"]);
  });

  it("every built-in action lands on a place", () => {
    for (const stage of W.stages) expect(PLACES).toContain(stage.next.to);
  });
});
