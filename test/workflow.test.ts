// Workflow as data — the vocabulary, the one built-in, and the reading.
//
// The table of facts → stage is the whole contract between the ledger and the
// event page: both call `readStage` on the same numbers, and this is where the
// one decision that is easy to undo in good faith is held — that a stage counts
// only WITH EVERY STAGE BEFORE IT, so an empty sale whose catalogue was opened
// once reads as New and not as Catalogued. The rest holds the vocabulary to its
// refusals, proves a person's answer wins and can be taken back, and reads a
// workflow the built-in knows nothing about, because a gallery's will be one.

import { existsSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  BUILT_IN_WORKFLOWS,
  CATALOGUE_PRODUCTION,
  PLACES,
  deriveStageIndex,
  placeHref,
  placeIsFile,
  readStage,
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
