// The panel's decisions and the engine's reservation — everything about the
// control that is not React.
//
// The component itself is not tested here and could not be: vitest runs
// `environment: "node"` with no jsdom, which is the reason the logic is in
// src/lib/polish/panel-model.ts in the first place. What a person can press,
// and what happens in the browser when they do, is test/e2e/polish.spec.ts.

import { describe, expect, it } from "vitest";

import type { OverrideValue } from "@/lib/data/overrides";
import { KEYLINE_MAX_MM, KEYLINE_MIN_MM, MAX_BANDS } from "@/lib/engine/plate";
import {
  PLATE_FIELD,
  bandsPatch,
  clearPolishPatch,
  conflictOf,
  contentReadout,
  cutoutTogglePatch,
  defaultGroundSpec,
  gradePatch,
  groundPatch,
  groundSpecPatch,
  isPolished,
  patchIsEmpty,
  platePatchFromValue,
  polishTargetOf,
  straightenPatch,
  tabsFor,
} from "@/lib/polish/panel-model";
import {
  ULTRA_WIDE_ASPECT,
  plateNotice,
  plateNoticeText,
  workAspect,
} from "@/lib/polish/plate-note";
import { serifVerdict } from "@/lib/polish/serif-check";

const PLATE = { lotId: "a", field: PLATE_FIELD };
const TITLE = { lotId: "a", field: "title" };

describe("polish is for a plate, and says so rather than disappearing", () => {
  it("both tabs are live on a photograph", () => {
    expect(tabsFor(PLATE, true).map((t) => [t.id, t.enabled])).toEqual([
      ["settings", true],
      ["polish", true],
    ]);
  });

  it("and on a caption row the tab is still there, greyed, with a reason", () => {
    const [, polish] = tabsFor(TITLE, true);
    expect(polish!.enabled).toBe(false);
    // THE SENTENCE NAMES WHAT TO SELECT INSTEAD. "Unavailable" tells a
    // specialist the software is broken; this tells them where to click.
    expect(polish!.reason).toContain("photograph");
    expect(polish!.reason).toContain("title");
  });

  it("and a lot with no photograph gets a different sentence, because the act differs", () => {
    const [, polish] = tabsFor(PLATE, false);
    expect(polish!.enabled).toBe(false);
    expect(polish!.reason).toContain("no photograph");
  });

  it("and nothing selected disables both", () => {
    expect(tabsFor(null, true).every((t) => !t.enabled)).toBe(true);
  });

  it("and a treatment can only be aimed at the plate", () => {
    expect(polishTargetOf(PLATE)).toEqual({ lotId: "a", field: "images" });
    expect(polishTargetOf(TITLE)).toBeNull();
    expect(polishTargetOf(null)).toBeNull();
  });
});

describe("the gestures keep the row's invariants", () => {
  it("clearing a ground clears its parameters in the same patch", () => {
    // BOTH LAYERS ENFORCE THIS AND BOTH ARE WANTED: the row can be trusted
    // whatever writes it, and the panel does not send a patch the row will
    // silently drop — which would leave the control showing a tint the page
    // has not got.
    expect(groundPatch({ ground: "tone" }, null)).toEqual({ ground: null, groundSpec: null });
  });

  it("and changing a ground keeps the level and tint already chosen", () => {
    const current: OverrideValue = { ground: "tone", groundSpec: { level: "dim", tint: "cool" } };
    expect(groundPatch(current, "sweep")).toEqual({
      ground: "sweep",
      groundSpec: { level: "dim", tint: "cool" },
    });
  });

  it("and moving to a keyline brings a width with it", () => {
    const patch = groundPatch({ ground: "tone", groundSpec: { level: "mid", tint: "warm" } }, "keyline");
    expect(patch.groundSpec?.widthMm).toBeGreaterThanOrEqual(KEYLINE_MIN_MM);
    expect(patch.groundSpec?.widthMm).toBeLessThanOrEqual(KEYLINE_MAX_MM);
  });

  it("and a mount takes no tone, so it is given none", () => {
    expect(defaultGroundSpec("mount")).toBeNull();
    expect(groundPatch({}, "mount")).toEqual({ ground: "mount", groundSpec: null });
  });

  it("and a spec change with no ground in force writes nothing", () => {
    expect(patchIsEmpty(groundSpecPatch({}, { level: "dim" }))).toBe(true);
  });

  it("a width is bounded where the specialist can see it, not only on arrival", () => {
    const patch = groundSpecPatch(
      { ground: "keyline", groundSpec: { level: "mid", tint: "neutral", widthMm: 1 } },
      { widthMm: 99 },
    );
    expect(patch.groundSpec?.widthMm).toBe(KEYLINE_MAX_MM);
  });

  it("去背 toggles between cut out and nobody-has-said", () => {
    expect(cutoutTogglePatch({})).toEqual({ picture: "cutout" });
    expect(cutoutTogglePatch({ picture: "cutout" })).toEqual({ picture: null });
    // `original` is a statement you make in the tab with three states in front
    // of you, not one you make by pressing a button twice.
    expect(cutoutTogglePatch({ picture: "original" })).toEqual({ picture: "cutout" });
  });

  it("a level angle clears rather than storing a zero", () => {
    expect(straightenPatch(0)).toEqual({ straightenDeg: null });
    expect(straightenPatch(0.004)).toEqual({ straightenDeg: null });
    expect(straightenPatch(-1.374)).toEqual({ straightenDeg: -1.37 });
    expect(straightenPatch(99)).toEqual({ straightenDeg: 15 });
  });

  it("one passage is a value and clearing is a separate gesture", () => {
    expect(bandsPatch(1)).toEqual({ bands: 1 });
    expect(bandsPatch(null)).toEqual({ bands: null });
    expect(bandsPatch(999)).toEqual({ bands: MAX_BANDS });
  });

  it("原狀 takes the treatments off and leaves the rest of the row alone", () => {
    const patch = clearPolishPatch();
    // The frame and the text correction are NOT in it: "put this photograph
    // back" does not mean "and move it back into the grid and restore the
    // typo".
    expect(Object.keys(patch).sort()).toEqual(
      ["bands", "grade", "ground", "groundSpec", "picture", "straightenDeg"],
    );
    expect(Object.values(patch).every((v) => v === null)).toBe(true);
  });

  it("and a plate with a subject box counts as polished, so 原狀 is offered", () => {
    expect(isPolished({})).toBe(false);
    expect(isPolished({ hidden: true })).toBe(false);
    expect(isPolished({ content: { x: 0, y: 0, w: 1, h: 1 } })).toBe(true);
  });

  it("one grade axis moves without disturbing the others", () => {
    expect(gradePatch({ grade: { warm: 10, vibrance: 5 } }, "warm", 30)).toEqual({
      grade: { warm: 30, vibrance: 5 },
    });
  });
});

describe("the one combination the page cannot honour", () => {
  it("is silent until both are actually set", () => {
    expect(conflictOf({})).toBeNull();
    expect(conflictOf({ bands: 4 })).toBeNull();
    expect(conflictOf({ straightenDeg: 0.7 })).toBeNull();
    // One passage is not passages: a whole work across the plate is still one
    // picture and turns exactly as any other does.
    expect(conflictOf({ bands: 1, straightenDeg: 0.7 })).toBeNull();
  });

  it("and names which of the two the page is obeying", () => {
    const said = conflictOf({ bands: 4, straightenDeg: 0.7 });
    expect(said).toContain("段數");
    expect(said).toContain("未套用");
  });

  it("and neither value is deleted to resolve it", () => {
    // A control that dropped one of two stored judgements to make them agree
    // is a lock rather than a default. Nothing in the panel's patch builders
    // couples the two.
    expect(bandsPatch(4)).toEqual({ bands: 4 });
    expect(straightenPatch(0.7)).toEqual({ straightenDeg: 0.7 });
  });
});

describe("a patch off the wire is rebuilt, never spread", () => {
  it("a key nobody declared cannot ride in on a treatment", () => {
    // A server function is reachable by direct POST. Without this, a request
    // that looked like a ground change could hide a lot's title.
    expect(
      platePatchFromValue({ ground: "tone", hidden: true, text: "x", frame: { x: 0, y: 0, w: 1, h: 1 } }),
    ).toEqual({ ground: "tone" });
  });

  it("an explicit null clears and a malformed value does not", () => {
    // THE THREE STATES. A malformed angle arriving as "erase the specialist's
    // straighten" would be a correction destroyed by a bug in the sender.
    expect(platePatchFromValue({ straightenDeg: null })).toEqual({ straightenDeg: null });
    expect(platePatchFromValue({ straightenDeg: "0.7" })).toEqual({});
    expect(platePatchFromValue({})).toEqual({});
    expect(platePatchFromValue(null)).toEqual({});
    expect(platePatchFromValue("ground")).toEqual({});
  });

  it("and a spec is judged against the ground in the same patch", () => {
    expect(
      platePatchFromValue({ ground: "mount", groundSpec: { level: "mid", tint: "warm" } }),
    ).toEqual({ ground: "mount" });
    expect(
      platePatchFromValue({ ground: "tone", groundSpec: { level: "mid", tint: "warm" } }),
    ).toEqual({ ground: "tone", groundSpec: { level: "mid", tint: "warm" } });
  });

  // ── THE GAP BETWEEN THE TWO HALVES ABOVE, WHICH SHIPPED ──────────────────
  //
  // Everything above proves the builders build well-formed patches and the
  // validator refuses ill-formed ones. Nothing proved that a patch from THIS
  // module survives THAT validator, and one did not: `groundSpecPatch` sent a
  // spec with no ground, the validator refused it for exactly the reason the
  // test above states, and every tone and every keyline width a specialist set
  // came back "there was nothing in that change to save". Both sides green, the
  // feature dead, and it took a browser reading the painted grey to see it.
  //
  // So the round trip is asserted for every builder that writes a spec, which
  // is the seam that broke and the one this module cannot check by inspection.
  it("survives the validator the action puts it through", () => {
    const tone: OverrideValue = { ground: "tone", groundSpec: { level: "mid", tint: "neutral" } };
    const line: OverrideValue = {
      ground: "keyline",
      groundSpec: { level: "mid", tint: "neutral", widthMm: 1 },
    };
    const trips = [
      groundPatch({}, "tone"),
      groundPatch(tone, "keyline"),
      groundSpecPatch(tone, { level: "dim" }),
      groundSpecPatch(tone, { tint: "warm" }),
      groundSpecPatch(line, { widthMm: 2 }),
      straightenPatch(-1.37),
      bandsPatch(4),
      cutoutTogglePatch({}),
      gradePatch({}, "vibrance", 50),
    ];
    for (const patch of trips) {
      const survived = platePatchFromValue(patch);
      expect(patchIsEmpty(survived)).toBe(false);
      // Not merely non-empty: the KEY the gesture was about has to be the one
      // that came through. A patch reduced to its ground would pass a bare
      // emptiness check and still lose the tone.
      for (const key of Object.keys(patch)) {
        expect(survived).toHaveProperty(key);
      }
    }
  });
});

describe("the engine's reservation about a plate", () => {
  it("says nothing about a plate nobody measured", () => {
    // Inventing a warning out of the absence of a measurement would mark every
    // plate in a house that has not backfilled.
    expect(plateNotice(null)).toBeNull();
    expect(plateNotice(undefined)).toBeNull();
    expect(plateNotice({ width: 0, height: 0 })).toBeNull();
  });

  it("and nothing about a plate of ordinary proportions", () => {
    expect(plateNotice({ width: 4000, height: 3000 })).toBeNull();
    expect(plateNotice({ width: 3000, height: 4000 })).toBeNull();
  });

  it("but names the ratio of a handscroll, and how many passages answer it", () => {
    const notice = plateNotice({ width: 28_700, height: 1000 });
    expect(notice?.kind).toBe("ultra-wide");
    expect(notice?.aspect).toBeCloseTo(28.7, 6);
    expect(notice?.passages).toBe(4);
    expect(plateNoticeText(notice!)).toContain("28.7:1");
    expect(plateNoticeText(notice!)).toContain("28700×1000");
  });

  it("and a tall scroll has the same problem with the page turned", () => {
    expect(workAspect({ width: 1000, height: 28_700 })).toBeCloseTo(28.7, 6);
  });

  it("and a human's subject box wins over the file's own shape", () => {
    // A square file whose subject is a strip across it IS a handscroll, and a
    // verdict computed from the whole file would describe a plate that is not
    // on the page.
    const square = { width: 4000, height: 4000 };
    expect(plateNotice(square)).toBeNull();
    expect(plateNotice(square, { w: 1, h: 0.05 })?.aspect).toBeCloseTo(20, 6);
  });

  it("and the sentence changes once the work has been answered", () => {
    const notice = plateNotice({ width: 20_000, height: 1000 })!;
    expect(plateNoticeText(notice)).toContain("建議");
    // Already cut: repeating the offer would read as the product not noticing.
    expect(plateNoticeText(notice, 3)).toContain("已分 3 段");
    expect(plateNoticeText(notice, 3)).not.toContain("建議");
    // Deliberately whole: a decision, not an unanswered question.
    expect(plateNoticeText(notice, 1)).toContain("整幅橫貫");
  });

  it("and the threshold is the one stated in the file", () => {
    expect(plateNotice({ width: ULTRA_WIDE_ASPECT * 1000, height: 1000 })).not.toBeNull();
    expect(plateNotice({ width: ULTRA_WIDE_ASPECT * 1000 - 1, height: 1000 })).toBeNull();
  });
});

describe("whether this machine can show the catalogue's type", () => {
  it("a serif from the stack is the answer the product wants", () => {
    const v = serifVerdict(["Noto Serif CJK HK"]);
    expect(v.fidelity).toBe("serif");
    expect(v.message).toContain("Noto Serif CJK HK");
  });

  it("but the sans rung is NOT a pass, which is the whole point of the check", () => {
    // A sans catalogue is a compromise and tofu is a reprint; the document
    // names the sans as the last rung before tofu. Counting it as a pass would
    // be the check quietly agreeing with the thing it exists to catch.
    const v = serifVerdict(["Noto Sans CJK HK"]);
    expect(v.fidelity).toBe("sans");
    expect(v.message).toContain("PDF");
  });

  it("and a bare machine is told what to install", () => {
    const v = serifVerdict([]);
    expect(v.fidelity).toBe("none");
    expect(v.message).toContain("Noto Serif CJK HK");
  });

  it("and a face the document does not name does not count", () => {
    expect(serifVerdict(["Comic Sans MS"]).fidelity).toBe("none");
  });
});

describe("what the subject box reads as", () => {
  it("says the plate is whole AND that nobody measured it", () => {
    // The distinction a specialist cannot see: there is no measurement coming.
    expect(contentReadout({})).toContain("無人另框");
  });

  it("and prints the box a person drew", () => {
    expect(contentReadout({ content: { x: 0.1, y: 0.2, w: 0.5, h: 0.6 } }))
      .toBe("主體框 10.0%, 20.0% — 50.0% × 60.0%");
  });
});
