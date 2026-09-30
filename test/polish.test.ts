// The polish renderer, and the one claim the four goldens depend on.
//
// ── THE CLAIM ───────────────────────────────────────────────────────────────
//
// A DOCUMENT WITH NO TREATMENT ON IT EMITS NOT ONE BYTE OF THIS FEATURE. That
// is what let a tranche add a ground, a turn, passages and a colour correction
// to the print path without moving `test/golden/*.html` — and it is a property
// of the renderer, not of the fixture those goldens happen to use. So it is
// asserted here directly, on a document derived WITH overrides that carry no
// plate keys, which is the case a golden cannot cover: the goldens' fixture has
// corrections on it, and passing them proves the untreated path is unchanged
// only for the five lots they happen to describe.
//
// ── AND THE CENSUS, EXTENDED RATHER THAN WIDENED ────────────────────────────
//
// golden.test.ts holds the stylesheet to sixteen house greys and says why: the
// set is CLOSED and NEUTRAL, so a brand colour arriving in the renderer is a
// decision rather than a tweak. A ground is a colour that is not one of the
// sixteen, and the honest thing was not to widen that list — it was to leave it
// exactly where it is, keep the ground OUT of the stylesheet, and count the
// polished document separately here. The sixteen are what this renderer picks
// for every catalogue whether anyone asked or not; a ground is what one
// specialist picked for one plate, and the two are different kinds of thing.

import { describe, expect, it } from "vitest";

import {
  DEFAULT_PARAMS,
  derive,
  type CatalogueParams,
  type EngineLot,
  type EngineOverride,
} from "@/lib/engine/derive";
import { BUILT_IN_TEMPLATES, CATALOGUE, PRICE_LIST, TEARSHEET } from "@/lib/engine/templates";
import { DEFAULT_FACE, FACES, faceFor } from "@/lib/engine/faces";
import { CJK_FACES, renderCatalogue } from "@/lib/render/html";
import {
  GROUND_GREY,
  RULE_GREY,
  cssSafeUrl,
  gradeChannelGains,
  gradeMatrix,
  gradeMatrixIsIdentity,
  gradeVibranceK,
  toneColour,
  straightenVars,
} from "@/lib/render/plate-css";

const SALE: EngineLot[] = [
  { id: "a", ref: "P01", fields: { title: "青花梅瓶" }, images: ["plate-a"] },
  { id: "b", ref: "P02", fields: { title: "山水四屏" }, images: ["plate-b"] },
  { id: "c", ref: "P03", fields: { title: "白玉佩" }, images: [] },
];

const on = (id: string): CatalogueParams => ({ ...DEFAULT_PARAMS, template: id });

const render = (overrides: EngineOverride[], template = CATALOGUE.id): string =>
  renderCatalogue(derive(SALE, on(template), [], overrides, BUILT_IN_TEMPLATES));

// ── The claim ───────────────────────────────────────────────────────────────

describe("an untreated document is untouched", () => {
  /**
   * The corrections a catalogue can carry that are NOT polish. If any of these
   * started pulling the polish block in, the goldens would move on the next
   * document somebody dragged a title on — which is the failure mode that
   * would be discovered by a diff nobody could explain.
   */
  const NOT_POLISH: EngineOverride[] = [
    { lotId: "a", field: "title", text: "改過的標題" },
    { lotId: "b", field: "images", frame: { x: 0.1, y: 0.1, w: 0.3, h: 0.2 } },
    { lotId: "c", field: "ref", hidden: true },
    { lotId: "a", field: "images", pageIndex: 3 },
  ];

  /**
   * THE ONE OF THOSE THAT MUST CHANGE NOTHING AT ALL.
   *
   * `pageIndex` is carried and deliberately not applied, and the whole of that
   * decision is in `derive`'s header. The polish tranche re-took it and did not
   * move it, so this is the assertion that keeps the conclusion true rather
   * than merely written down: a page number in the row produces the same
   * document, byte for byte, in every arrangement.
   */
  it.each([CATALOGUE.id, PRICE_LIST.id, TEARSHEET.id])(
    "%s is untouched by a stored page number",
    (template) => {
      const named = [{ lotId: "a", field: "images", pageIndex: 3 }];
      expect(render(named, template)).toBe(render([], template));
    },
  );

  it("and carries no trace of this feature", () => {
    const html = render(NOT_POLISH);
    for (const mark of ["pic", "data-ground", "data-straighten", "data-grade", "feColorMatrix"]) {
      expect(html, `an untreated document mentions ${mark}`).not.toContain(mark);
    }
  });

  /**
   * A TREATMENT ON A LOT WITH NO PHOTOGRAPH IS STILL NOT PAINT. The decision is
   * published — somebody made it — but there is nothing to ground, so the
   * stylesheet stays out. Without this the empty dashed box that stands in for
   * a missing plate would acquire a studio sweep.
   */
  it("and a treatment with no photograph to apply it to paints nothing", () => {
    const html = render([{ lotId: "c", field: "images", ground: "sweep" }]);
    expect(html).not.toContain(".pic {");
    expect(html).toContain('data-ground="sweep"');
  });

  /**
   * A TREATMENT ON A CAPTION ROW IS NOT A TREATMENT. The panel cannot write
   * one and the engine does not read one, but the column is jsonb and a
   * hand-written statement can put anything anywhere.
   */
  it("and a ground stored against a title is carried, never painted", () => {
    expect(render([{ lotId: "a", field: "title", ground: "mount" }])).toBe(render([]));
  });
});

// ── The block ───────────────────────────────────────────────────────────────

describe("a polished document carries the block once", () => {
  const html = render([
    { lotId: "a", field: "images", ground: "tone", groundSpec: { level: "mid", tint: "warm" } },
    { lotId: "b", field: "images", straightenDeg: 0.7 },
  ]);

  it("exactly once, however many plates asked for it", () => {
    expect(html.split(".pic {").length - 1).toBe(1);
  });

  it("and only the plates that asked carry a box", () => {
    expect(html.split('class="pic').length - 1).toBe(2);
  });

  /**
   * THE CASCADE, PINNED — because it is where this feature broke twice.
   *
   * The rules a treatment has to beat are the arrangements' own and they are
   * specific: `.page--grid .plate img` is (0,2,1) and `.page--table
   * .placed.plate img` is (0,3,1). A bare `.pic img` loses to both whatever
   * the order, and the visible symptom is a straightened plate sized to its
   * box instead of to the turn, showing paper at the corners. So two things
   * have to stay true, and neither is visible in a diff of the rule itself:
   * the block is LAST, and every picture rule is qualified to three classes.
   */
  it("and the block is last, so its rules win the ties they are written for", () => {
    expect(html.indexOf(".pic {")).toBeGreaterThan(html.indexOf(".page--sheet .placed"));
    expect(html.indexOf(".pic {")).toBeLessThan(html.indexOf("@media print"));
  });

  it("and every rule about a picture is qualified past the arrangement's own", () => {
    const rules = [...html.matchAll(/^ {2}(\.[^{\n]*\.pic[^{\n]*)\{/gm)].map((m) => m[1]!.trim());
    const onPictures = rules.filter((r) => / img|\.band/.test(r));
    expect(onPictures.length).toBeGreaterThan(0);
    for (const rule of onPictures) {
      for (const selector of rule.split(",")) {
        expect(selector.trim(), `${selector.trim()} is not qualified .page .plate`)
          .toMatch(/^\.page \.plate \./);
      }
    }
  });

  /**
   * THE CENSUS, over a polished document.
   *
   * Sixteen house greys plus exactly what the specialist chose, and nothing
   * else. The two `color-mix` derivations are stated in terms of the chosen
   * ground rather than as colours of their own, which is why they appear here
   * as expressions and not as values — a hex smuggled into one of them would
   * show up in this list.
   */
  it("and adds no colour the house did not already have, beyond the chosen ground", () => {
    // golden.test.ts's own regex, verbatim, so the two censuses cannot
    // disagree about what a colour is.
    //
    // A SECOND HOLE IN IT, found here and worth writing down beside the one it
    // already names (named colours): `[^)]*` stops at the FIRST closing
    // parenthesis, so a nested function is truncated — both derivations below
    // come back as `color-mix(in oklab, var(--pg)` and deduplicate to one
    // entry. It is not a hole this feature can fall through, because what the
    // truncation hides is a percentage and the word black; a HEX inside a
    // nested function would still be caught by the first alternative. Left as
    // it is rather than widened, so that both files count the same way.
    const COLOUR =
      /#[0-9a-f]{3,8}\b|(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color-mix|color)\([^)]*\)/gi;
    const found = [...new Set(html.match(COLOUR) ?? [])].sort();
    const HOUSE_GREYS = [
      "#1b1b1b", "#3a3a3a", "#5a5a5a", "#6e6e6e", "#8a8a8a", "#a8a8a8",
      "#b4b4b4", "#dcdcdc", "#e0e0e0", "#f6f6f6", "#fafafa", "#fcfcfc", "#fff",
      "rgba(0,0,0,.06)", "rgba(0,0,0,.10)", "rgba(255,255,255,0)",
    ];
    const POLISH = [
      // The mount's and the sweep's derivations, both stated in terms of the
      // ground the specialist chose and neither naming a colour of its own.
      "color-mix(in oklab, var(--pg)",
      // That ground, and it is the ONLY value in the document this file did
      // not pick: mid, warm, from the ladder and the tint rule.
      toneColour(GROUND_GREY, "mid", "warm"),
    ];
    expect(found).toEqual([...HOUSE_GREYS, ...POLISH].sort());
  });
});

// ── The grounds ─────────────────────────────────────────────────────────────

describe("a ground", () => {
  it("is an equal-channel grey, and a tint moves red and blue apart", () => {
    expect(toneColour(GROUND_GREY, "mid", "neutral")).toBe("#e3e3e3");
    // mid's step is 5: 0xe3 + 5 = 0xe8, 0xe3 − 5 = 0xde.
    expect(toneColour(GROUND_GREY, "mid", "warm")).toBe("#e8e3de");
    expect(toneColour(GROUND_GREY, "mid", "cool")).toBe("#dee3e8");
    // Green is untouched by a tint, which is what keeps the luminance put —
    // checked on every level of both ladders rather than on one.
    for (const ladder of [GROUND_GREY, RULE_GREY]) {
      for (const level of ["light", "mid", "dim"] as const) {
        const grey = ladder[level].toString(16).padStart(2, "0");
        for (const tint of ["neutral", "warm", "cool"] as const) {
          expect(toneColour(ladder, level, tint).slice(3, 5)).toBe(grey);
        }
      }
    }
  });

  /**
   * A KEYLINE IS A LINE AND NOT A FIELD, so its three steps live where ink
   * lives. Drawn from the ground ladder, the light step would be a rule the
   * press cannot hold; this pins that the two ladders are genuinely apart
   * rather than the same numbers under two names.
   */
  it("and a keyline's rule is drawn from the ink ladder, not the ground one", () => {
    for (const level of ["light", "mid", "dim"] as const) {
      expect(RULE_GREY[level]).toBeLessThan(GROUND_GREY[level]);
    }
  });

  it("falls to mid neutral when a hand-written row carries no spec", () => {
    const html = render([{ lotId: "a", field: "images", ground: "tone" }]);
    expect(html).toContain("--pg:#e3e3e3");
  });

  it("and a keyline keeps its width in millimetres", () => {
    const html = render([
      {
        lotId: "a",
        field: "images",
        ground: "keyline",
        groundSpec: { level: "dim", tint: "neutral", widthMm: 0.75 },
      },
    ]);
    expect(html).toContain("--pw:0.75mm");
    expect(html).toContain('class="pic pic--keyline"');
  });
});

// ── 拉直 ─────────────────────────────────────────────────────────────────────

describe("a straighten covers the plate exactly", () => {
  /**
   * THE ARITHMETIC THE CSS RESTS ON, checked here rather than trusted.
   *
   * The picture is given the bounding box of the plate turned by the angle —
   * (w·cos + h·sin) by (w·sin + h·cos) — so turning it back covers the plate
   * with equality and no slack. This walks a range of plate shapes and angles
   * and asserts that every corner of the plate lands inside the turned
   * picture, which is the property the `calc` is there to produce.
   */
  it("for every plate shape and every angle the bound permits", () => {
    for (const deg of [-15, -7.5, -0.7, 0.01, 0.7, 7.5, 15]) {
      const vars = Object.fromEntries(
        straightenVars({ straightenDeg: deg }).map((v) => v.split(":") as [string, string]),
      );
      const c = Number(vars["--tc"]);
      const s = Number(vars["--ts"]);
      const SHAPES: [number, number][] = [[100, 100], [160, 90], [40, 300], [297, 210]];
      for (const [w, h] of SHAPES) {
        const pw = w * c + h * s;
        const ph = w * s + h * c;
        // The plate's corners, expressed in the turned picture's own frame.
        const rad = (deg * Math.PI) / 180;
        for (const x of [-w / 2, w / 2]) {
          for (const y of [-h / 2, h / 2]) {
            const ux = Math.cos(rad) * x + Math.sin(rad) * y;
            const uy = -Math.sin(rad) * x + Math.cos(rad) * y;
            // A thousandth of a millimetre of tolerance, which is the rounding
            // of the two coefficients to six decimals and nothing else.
            expect(Math.abs(ux)).toBeLessThanOrEqual(pw / 2 + 1e-3);
            expect(Math.abs(uy)).toBeLessThanOrEqual(ph / 2 + 1e-3);
          }
        }
      }
    }
  });

  it("and is centred unless a subject box says otherwise", () => {
    expect(straightenVars({ straightenDeg: 1 })).toContain("--tx:50.0000%");
    const withSubject = straightenVars({
      straightenDeg: 1,
      content: { x: 0.1, y: 0.2, w: 0.4, h: 0.4 },
    });
    expect(withSubject).toContain("--tx:30.0000%");
    expect(withSubject).toContain("--ty:40.0000%");
  });

  it("and turning left and turning right ask for the same box", () => {
    const left = straightenVars({ straightenDeg: -3 });
    const right = straightenVars({ straightenDeg: 3 });
    expect(left.filter((v) => v.startsWith("--tc") || v.startsWith("--ts")))
      .toEqual(right.filter((v) => v.startsWith("--tc") || v.startsWith("--ts")));
    expect(left).toContain("--td:-3.00deg");
    expect(right).toContain("--td:3.00deg");
  });

  it("and publishes the angle at the resolution it is stored at", () => {
    expect(render([{ lotId: "a", field: "images", straightenDeg: -0.73 }]))
      .toContain('data-straighten="-0.73"');
  });
});

// ── 段數 ─────────────────────────────────────────────────────────────────────

describe("passages", () => {
  const banded = (bands: number, url = "/api/assets/plate-a"): string =>
    renderCatalogue(
      derive(SALE, on(CATALOGUE.id), [], [{ lotId: "a", field: "images", bands }], BUILT_IN_TEMPLATES),
      { asset: () => url },
    );

  it("declare the photograph once, whatever the count", () => {
    const html = banded(6);
    // ONE reference for six bands. Six <img> would be six copies of a data URI
    // in the PDF, which is the ceiling the export already has to police.
    expect(html.split("/api/assets/plate-a").length - 1).toBe(
      // lot b's plate is untreated and still carries one.
      2,
    );
    expect(html.split('class="band"').length - 1).toBe(6);
    expect(html).toContain("--pspan:600%");
  });

  it("and step from one end of the work to the other", () => {
    const html = banded(3);
    for (const at of ["0.0000%", "50.0000%", "100.0000%"]) {
      expect(html).toContain(`--at:${at}`);
    }
  });

  it("but one passage is one picture, not a band", () => {
    // 1 IS A VALUE — "show this work whole" — and the honest rendering of it
    // is the plate this renderer already draws. A single band would be a
    // division by zero in the position and a background where an <img> works.
    const html = banded(1);
    expect(html).not.toContain('class="band"');
    expect(html).toContain('data-bands="1"');
  });

  it("and an asset reference CSS cannot hold falls back to a picture", () => {
    // The only two shapes either resolver produces are permitted; anything
    // else does not go into a stylesheet at all.
    expect(cssSafeUrl("/api/assets/abc123")).toBe(true);
    expect(cssSafeUrl("data:image/jpeg;base64,QUJD")).toBe(true);
    expect(cssSafeUrl("/api/assets/a');background:url('evil")).toBe(false);
    expect(cssSafeUrl("https://example.test/x.jpg")).toBe(false);
    const html = banded(3, "https://example.test/x.jpg");
    expect(html).not.toContain('class="band"');
    expect(html).toContain("<img");
  });
});

// ── 調色 ─────────────────────────────────────────────────────────────────────

describe("a colour correction", () => {
  it("leaves a neutral grey where it was when only the cast moves", () => {
    // The gains are normalised by the luma they would give a neutral, so a
    // mid-grey changes hue and keeps its lightness. Anything else means the
    // two axes fight over one number.
    const [r, g, b] = gradeChannelGains({ warm: 100 });
    expect(0.213 * r + 0.715 * g + 0.072 * b).toBeCloseTo(1, 12);
    expect(r).toBeGreaterThan(1);
    expect(b).toBeLessThan(1);
  });

  it("and is exactly unity when neither cast axis is set", () => {
    // Not "close to" 1. A tone-only correction must emit a tone-only matrix,
    // or two builds of the same catalogue differ in the sixteenth digit.
    expect(gradeChannelGains({ black: 20 })).toEqual([1, 1, 1]);
  });

  it("takes the black point off before the gain, which is physical", () => {
    // out = gain·(in − black)/(white − black). The offset column is therefore
    // −gain·black/span and not −black.
    const m = gradeMatrix({ black: 51, white: 255 });
    const span = 1 - 51 / 255;
    expect(m[0]).toBeCloseTo(1 / span, 12);
    expect(m[4]).toBeCloseTo(-(51 / 255) / span, 12);
    expect(gradeMatrixIsIdentity(m)).toBe(false);
    expect(gradeMatrixIsIdentity(gradeMatrix({ vibrance: 40 }))).toBe(true);
  });

  it("emits one primitive for a cast and the whole chain for a vibrance", () => {
    const cast = render([{ lotId: "a", field: "images", grade: { warm: 20 } }]);
    expect(cast.split("<feColorMatrix").length - 1).toBe(1);
    expect(cast).not.toContain("feBlend");

    const vibrant = render([{ lotId: "a", field: "images", grade: { vibrance: 50 } }]);
    // The mask is built from per-channel max and min, which only feBlend has.
    expect(vibrant).toContain('<feBlend mode="lighten"');
    expect(vibrant).toContain('<feBlend mode="darken"');
    // KEEP = 1 − chroma with k4=1, so alpha lands back on 1 — the fix for the
    // failure that collapsed the whole filter to blanket saturation in the PDF.
    expect(vibrant).toContain('k2="1" k3="-1" k4="1" result="KEEP"');
    expect(gradeVibranceK({ vibrance: 100 })).toBeCloseTo(0.6, 12);
  });

  it("and publishes five integers whether or not each was stored", () => {
    expect(render([{ lotId: "a", field: "images", grade: { warm: 20 } }]))
      .toContain('data-grade="20,0,0,255,0"');
  });

  it("and the correction is on the picture, never on the ground behind it", () => {
    const html = render([
      { lotId: "a", field: "images", ground: "tone", grade: { warm: 20 } },
    ]);
    // The filter is on the img and on the bands and on nothing that carries a
    // ground, so a colour aimed at a photograph cannot reach a colour the
    // house chose.
    expect(html).toContain(".pic--grade img, .page .plate .pic--grade .band { filter: var(--pf); }");
    expect(html).not.toContain(".pic--grade { filter");
  });
});

// ── 主體框 ───────────────────────────────────────────────────────────────────

describe("the subject box", () => {
  /**
   * THIS IS THE WHOLE RENDERER PATH FOR `content`, and it is one attribute.
   * `parseContent` and `subjectRect` (src/lib/editor/drag-geometry.ts) have
   * been waiting for a renderer to publish it since they were written; the
   * spike in src/lib/render/plate-css.ts's header says why the value can only
   * come from a person.
   */
  it("is published on the element that carries the plate's identity", () => {
    const html = render([
      { lotId: "a", field: "images", content: { x: 0.1, y: 0.2, w: 0.5, h: 0.6 } },
    ]);
    expect(html).toContain(
      'data-field="images" data-content="0.100000,0.200000,0.500000,0.600000"',
    );
  });

  it("at the resolution it is stored at, so two readers cannot disagree", () => {
    // Six decimals, FIXED rather than trimmed. `parseContent` reads four
    // numbers off a comma-separated string and a trailing zero costs it
    // nothing; a consumer that compared the attribute to the stored value as
    // TEXT would be the one that cared, and it would be right to.
    const html = render([
      { lotId: "a", field: "images", content: { x: 1 / 3, y: 0, w: 0.5, h: 1 } },
    ]);
    expect(html).toContain('data-content="0.333333,0.000000,0.500000,1.000000"');
  });
});

// ── The serif ───────────────────────────────────────────────────────────────

describe("the document's faces and the probe's faces are one list", () => {
  /**
   * A FACE'S STACK IS NOT INTERPOLATED FROM ITS LIST — the declaration is
   * wrapped and indented, and rebuilding that from a join would put the bytes
   * of every catalogue at the mercy of a template literal. So the two copies
   * are held together here instead, per face and in both directions: every
   * rung the face names appears in the document it produces, in order, and
   * that document's stack names no CJK face the list has not got.
   *
   * It is a real defect and not a hypothetical one: src/lib/render/pdf.ts
   * carried its own list and asked about "Noto Sans CJK TC" while the document
   * asked for "Noto Sans CJK HK".
   *
   * PER FACE, since the typeface became a parameter. One assertion over one
   * hardcoded stack was enough while there was one; with two it would pass
   * while the second face's rungs and its probe list drifted apart, which is
   * exactly the defect above with a different name.
   */
  it.each(FACES.map((face) => [face.name.en, face] as const))(
    "%s names its rungs in the order the document asks for them",
    (_name, face) => {
      const html = renderCatalogue(
        derive(SALE, { ...DEFAULT_PARAMS, face: face.id }, [], []),
      );
      let at = 0;
      for (const rung of face.cjk) {
        const found = html.indexOf(`"${rung}"`, at);
        expect(found, `${rung} is not in the stack after the one before it`)
          .toBeGreaterThan(-1);
        at = found;
      }
    },
  );

  it.each(FACES.map((face) => [face.name.en, face] as const))(
    "%s names no CJK face its own list has not got",
    (_name, face) => {
      const html = renderCatalogue(
        derive(SALE, { ...DEFAULT_PARAMS, face: face.id }, [], []),
      );
      const stack = html.slice(html.indexOf("font-family:"), html.indexOf("color: #1b1b1b"));
      const quoted = [...stack.matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
      const cjk = quoted.filter((f) => /CJK|TC|Songti|Han|PingFang|JhengHei/.test(f));
      expect(cjk).toEqual([...face.cjk]);
    },
  );

  /** Every rung any face names is one the probe asks a machine about. */
  it("and the probe's union covers every rung of every face", () => {
    for (const face of FACES) {
      for (const rung of face.cjk) {
        expect(CJK_FACES, `${rung} is named by ${face.name.en} and never probed for`)
          .toContain(rung);
      }
    }
  });

  /**
   * THE FIFTH GOLDEN, AS AN ASSERTION RATHER THAN A FILE.
   *
   * A 黑體 catalogue is pinned byte-exactly by this plus the four goldens: the
   * 明體 render is frozen on disk, and this says the 黑體 render is that
   * document with the font declaration and its comment changed and nothing
   * else. A fifth saved page would assert the same thing and cost a file that
   * a person has to regenerate and re-read every time the page legitimately
   * changes.
   *
   * IT IS A REAL GUARD, not a restatement. The face reaches the renderer
   * through CatalogueParams, which the engine also reads — so a change that
   * let the face touch pagination, a caption budget or a column width would
   * fail here, naming the first byte that moved for the wrong reason.
   */
  it("and two faces differ in the type and nowhere else", () => {
    const at = (id: string): string =>
      renderCatalogue(derive(SALE, { ...DEFAULT_PARAMS, face: id }, [], []));
    const cut = (html: string): string => {
      const from = html.indexOf("    /*", html.indexOf("background: #f6f6f6;"));
      const to = html.indexOf("color: #1b1b1b");
      return html.slice(0, from) + html.slice(to);
    };
    expect(at("serif")).not.toBe(at("sans"));
    expect(cut(at("sans"))).toBe(cut(at("serif")));
  });

  /** An unknown face prints the default rather than failing or printing tofu. */
  it("and a face nobody recognises is the one every old catalogue is in", () => {
    const at = (params: Partial<typeof DEFAULT_PARAMS>): string =>
      renderCatalogue(derive(SALE, { ...DEFAULT_PARAMS, ...params }, [], []));
    expect(at({ face: "helvetica" })).toBe(at({ face: DEFAULT_FACE.id }));
    expect(faceFor(undefined).id).toBe(DEFAULT_FACE.id);
  });
});
