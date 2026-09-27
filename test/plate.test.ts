// The plate's vocabulary: what a value MEANS, and that it means the same thing
// on the way in and on the way out.
//
// ── WHY THE ROUND TRIP IS THE TEST AND NOT THE VALIDATION ──────────────────
//
// src/lib/data/overrides.ts normalises through ONE reader on both paths, so the
// claim worth holding is not "this refuses junk" — it is "a value that survives
// a write is exactly the value that comes back". A second validator would pass
// a validation test and still lose a specialist's keyline width on the way to
// the database, which is the failure this shape exists to prevent and is
// invisible to any test that checks the two halves separately.
//
// These run against the pure functions, with no database: `mergeOverride` and
// `overrideFromValue` are where the rule lives, and test/corrections.db.test.ts
// already proves the SQL round-trips what they produce.

import { describe, expect, it } from "vitest";

import {
  mergeOverride,
  overrideFromValue,
  type OverrideValue,
} from "@/lib/data/overrides";
import {
  GRADE_AXES,
  GRADE_KEYS,
  KEYLINE_MAX_MM,
  KEYLINE_MIN_MM,
  MAX_BANDS,
  STRAIGHTEN_MAX_DEG,
  clampPlateGrade,
  formatGradeValue,
  formatStraightenDeg,
  nudgeGrade,
  nudgeStraightenDeg,
  plateFromValue,
  withGradeAxis,
  type PlateTreatment,
} from "@/lib/engine/plate";

/**
 * Every plate key, with a value that is legal and is not a default.
 *
 * ONE FIXTURE FOR THE WHOLE VOCABULARY, so that adding a key and forgetting to
 * carry it through the merge turns this file red rather than shipping a
 * treatment the row silently drops.
 */
const EVERY: PlateTreatment = {
  picture: "cutout",
  ground: "keyline",
  groundSpec: { level: "dim", tint: "warm", widthMm: 1.25 },
  bands: 4,
  straightenDeg: -0.73,
  content: { x: 0.1, y: 0.2, w: 0.5, h: 0.6 },
  grade: { warm: 15, green: -10, black: 20, white: 240, vibrance: 35 },
};

describe("the plate vocabulary round-trips whole", () => {
  it("every key survives a read", () => {
    expect(plateFromValue({ ...EVERY })).toEqual(EVERY);
  });

  it("and survives a write, which is the same reader", () => {
    expect(mergeOverride({}, { ...EVERY })).toEqual(EVERY);
  });

  it("and each key can be cleared on its own, leaving the rest", () => {
    // THE WHOLE POINT OF A PATCH. A specialist changing the ground must not
    // lose the angle they set a minute earlier — which is the failure the
    // merge exists to prevent, stated one key at a time.
    //
    // ONE PAIR IS EXEMPT AND IT IS THE INVARIANT RATHER THAN AN EXCEPTION.
    // `groundSpec` cannot outlive `ground`, so clearing the ground takes the
    // spec with it — measured here by writing the loop without the exemption
    // and reading what it said. The pair is pinned on its own below.
    const travelsWith: Partial<Record<keyof PlateTreatment, keyof PlateTreatment>> = {
      ground: "groundSpec",
    };
    for (const key of Object.keys(EVERY) as (keyof PlateTreatment)[]) {
      const after = mergeOverride({ ...EVERY }, { [key]: null });
      expect(after, `clearing ${key} emptied the row`).not.toBeNull();
      expect(after![key]).toBeUndefined();
      const remaining = Object.keys(EVERY).filter(
        (k) => k !== key && k !== travelsWith[key],
      );
      for (const other of remaining) {
        expect(after![other as keyof PlateTreatment], `${other} was lost clearing ${key}`)
          .toEqual(EVERY[other as keyof PlateTreatment]);
      }
    }
  });

  it("and a row with nothing left is a row that should not exist", () => {
    const cleared = Object.fromEntries(Object.keys(EVERY).map((k) => [k, null]));
    expect(mergeOverride({ ...EVERY }, cleared)).toBeNull();
  });

  /**
   * THE DRIFT GUARD src/lib/data/overrides.ts PROMISES.
   *
   * `OverrideValue` spells the plate's keys out instead of intersecting
   * `PlateTreatment`, because an interface in an intersection loses the
   * implicit index signature the jsonb column needs. A comment says the two
   * cannot drift; this is what makes that true. A key added to the vocabulary
   * and not to the stored value would be a treatment the panel can set and the
   * row cannot hold.
   */
  it("and the stored value knows exactly the keys the vocabulary has", () => {
    const stored = mergeOverride({}, { ...EVERY, hidden: true, text: "x", pageIndex: 2 });
    const plateKeys = Object.keys(plateFromValue({ ...EVERY }) ?? {}).sort();
    const inStored = Object.keys(stored ?? {})
      .filter((k) => !["hidden", "text", "pageIndex", "frame"].includes(k))
      .sort();
    expect(inStored).toEqual(plateKeys);
  });
});

describe("a ground's parameters cannot outlive its ground", () => {
  it("a spec with no ground is not stored", () => {
    expect(overrideFromValue({ groundSpec: { level: "mid", tint: "warm" } })).toBeNull();
  });

  it("a width belongs to the keyline and to nothing else", () => {
    const tone = plateFromValue({ ground: "tone", groundSpec: { level: "mid", tint: "cool", widthMm: 1 } });
    expect(tone?.groundSpec).toEqual({ level: "mid", tint: "cool" });
    const key = plateFromValue({ ground: "keyline", groundSpec: { level: "mid", tint: "cool", widthMm: 1 } });
    expect(key?.groundSpec?.widthMm).toBe(1);
  });

  it("a mount takes no tone at all, so its spec is dropped", () => {
    const mount = plateFromValue({ ground: "mount", groundSpec: { level: "mid", tint: "warm" } });
    expect(mount).toEqual({ ground: "mount" });
  });

  it("and a width is clamped rather than refused, because jsonb is jsonb", () => {
    const wide = plateFromValue({ ground: "keyline", groundSpec: { level: "mid", tint: "neutral", widthMm: 99 } });
    expect(wide?.groundSpec?.widthMm).toBe(KEYLINE_MAX_MM);
    const thin = plateFromValue({ ground: "keyline", groundSpec: { level: "mid", tint: "neutral", widthMm: 0 } });
    expect(thin?.groundSpec?.widthMm).toBe(KEYLINE_MIN_MM);
  });

  it("and clearing the ground must be told to clear the spec too", () => {
    // The merge is honest about this: dropping `ground` alone leaves a spec
    // the reader then refuses, so the row comes back with neither. The PANEL
    // sends both (panel-model.ts, `groundPatch`) so that what it shows and
    // what is stored cannot differ; this pins that the storage layer survives
    // a caller that does not.
    expect(mergeOverride({ ground: "tone", groundSpec: { level: "mid", tint: "warm" } }, { ground: null }))
      .toBeNull();
  });
});

describe("absence and neutral are one state", () => {
  it("a level plate stores no angle", () => {
    expect(plateFromValue({ straightenDeg: 0 })).toBeNull();
    expect(plateFromValue({ straightenDeg: 0.004 })).toBeNull();
  });

  it("an angle is rounded before it is bounded", () => {
    // 15.004 lands on 15.00 rather than being clamped by a ten-thousandth.
    expect(plateFromValue({ straightenDeg: 15.004 })?.straightenDeg).toBe(STRAIGHTEN_MAX_DEG);
    expect(plateFromValue({ straightenDeg: -99 })?.straightenDeg).toBe(-STRAIGHTEN_MAX_DEG);
  });

  it("a neutral grade axis is not stored, and a wholly neutral grade is nothing", () => {
    expect(clampPlateGrade({ warm: 0, green: 0, black: 0, white: 255, vibrance: 0 })).toBeNull();
    expect(clampPlateGrade({ warm: 0, vibrance: 12 })).toEqual({ vibrance: 12 });
  });

  it("and a grade's tonal endpoints are put back in order rather than refused", () => {
    // A black point at or above the white point is a division by zero. The
    // WHITE point yields, because the black point is the one a specialist sets
    // deliberately.
    const fixed = clampPlateGrade({ black: 200, white: 100 });
    expect(fixed?.black).toBe(200);
    expect(fixed?.white).toBe(201);
  });

  it("and every axis is bounded to its own range", () => {
    for (const key of GRADE_KEYS) {
      const { min, max, neutral } = GRADE_AXES[key];
      // A bound that IS the neutral is dropped rather than stored, which is
      // the rule above applied at the end of a ladder: the black point's floor
      // is 0 and 0 is "no black point", so a row asking for −1000 asserts
      // nothing. Read the two together — this is why the expectation is keyed
      // to the neutral and not written twice.
      const low = clampPlateGrade({ [key]: min - 1000 })?.[key];
      const high = clampPlateGrade({ [key]: max + 1000 })?.[key];
      expect(low, `${key} floor`).toBe(min === neutral ? undefined : min);
      expect(high, `${key} ceiling`).toBe(max === neutral ? undefined : max);
    }
  });
});

describe("bands", () => {
  it("one is a value and not an absence", () => {
    expect(plateFromValue({ bands: 1 })).toEqual({ bands: 1 });
  });

  it("and a hand-edited row cannot turn one plate into ten thousand", () => {
    expect(plateFromValue({ bands: 10_000 })).toBeNull();
    expect(plateFromValue({ bands: MAX_BANDS })).toEqual({ bands: MAX_BANDS });
    expect(plateFromValue({ bands: 2.5 })).toBeNull();
    expect(plateFromValue({ bands: 0 })).toBeNull();
  });
});

describe("the ladders a control walks", () => {
  it("a nudge lands on the ladder rather than adding to where it was", () => {
    // Typed 0.37, pressed +: 0.40, not 0.47. Pressing from anywhere lands on a
    // multiple of the step, so no sequence of presses strands the value.
    expect(nudgeStraightenDeg(0.37, 1)).toBe(0.4);
    expect(nudgeStraightenDeg(0.37, -1)).toBe(0.3);
    expect(nudgeStraightenDeg(0.4, 1)).toBe(0.5);
    expect(nudgeStraightenDeg(0.4, -1)).toBe(0.3);
  });

  it("and the fine step reaches the stored resolution", () => {
    expect(nudgeStraightenDeg(0, 1, 0.01)).toBe(0.01);
  });

  it("and it cannot be pushed past the bound", () => {
    expect(nudgeStraightenDeg(STRAIGHTEN_MAX_DEG, 1)).toBe(STRAIGHTEN_MAX_DEG);
  });

  it("the grade's ladder behaves the same on every axis", () => {
    expect(nudgeGrade("warm", 37, 1)).toBe(40);
    expect(nudgeGrade("warm", 37, -1)).toBe(35);
    // The white point's neutral is 255, so a first press down from nothing
    // moves off the top rather than up from zero.
    expect(nudgeGrade("white", undefined, -1)).toBe(250);
  });

  it("and one axis changes without disturbing the others", () => {
    const g = { warm: 10, vibrance: 20 };
    expect(withGradeAxis(g, "warm", 30)).toEqual({ warm: 30, vibrance: 20 });
    expect(withGradeAxis(g, "warm", null)).toEqual({ vibrance: 20 });
    expect(withGradeAxis({ warm: 10 }, "warm", null)).toBeNull();
  });
});

describe("what a person reads", () => {
  it("an angle is always signed, because the sign is the whole content", () => {
    expect(formatStraightenDeg(0.7)).toBe("+0.70");
    expect(formatStraightenDeg(-0.7)).toBe("−0.70");
    expect(formatStraightenDeg(undefined)).toBe("0.00");
  });

  it("an amount is signed and a level is not", () => {
    expect(formatGradeValue("warm", 12)).toBe("+12");
    expect(formatGradeValue("warm", -12)).toBe("−12");
    // "+32" on a black point would read as "thirty-two levels further", which
    // is a different and wrong statement.
    expect(formatGradeValue("black", 32)).toBe("32");
  });
});

describe("a value that is somebody else's is not a treatment", () => {
  it("a proposal is refused whatever it carries", () => {
    expect(overrideFromValue({ proposal: true, ground: "tone" })).toBeNull();
  });

  it("and junk in a plate key is dropped rather than breaking the row", () => {
    const value: OverrideValue | null = overrideFromValue({
      hidden: true,
      ground: "chartreuse",
      straightenDeg: "0.7",
      bands: [],
      grade: "warm",
    });
    expect(value).toEqual({ hidden: true });
  });
});
