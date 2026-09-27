// What a plate's polish LOOKS LIKE — the fragments src/lib/render/html.ts
// interpolates, and the arithmetic behind them.
//
// SEPARATE FROM html.ts, and the reason is that file's own standing: it is the
// print path, four whole documents are pinned byte for byte against it, and a
// stylesheet that moves changes what every catalogue already in production
// prints. Two hundred lines of colour-matrix arithmetic inside it would make
// every future diff of the print path unreadable, which is the condition under
// which a golden stops being reviewed and starts being regenerated. The
// predecessor split the same way — core held the vocabulary, render/ held the
// paint, one file per treatment — and this is those files collapsed into one,
// because there is one renderer here and not four.
//
// ── THE RULE THIS WHOLE FILE IS BUILT AROUND ────────────────────────────────
//
// A DOCUMENT WITH NO POLISH ON IT EMITS NOT ONE BYTE FROM HERE. Not a class,
// not an attribute, not a rule in the stylesheet. `polishStyles` returns the
// empty string for such a document and `html.ts` interpolates it with no
// surrounding whitespace, so a catalogue nobody has polished is byte-identical
// to one rendered before this existed — which is the only reason the four
// goldens could survive this tranche, and is checked by them rather than
// claimed here.
//
// It is also why every per-plate number below travels as a CSS CUSTOM PROPERTY
// on the element rather than as a generated rule: the block of CSS is then a
// constant string, one copy per document, and the only thing that varies is
// the handful of values on the plates that asked for something.
//
// ── THE SPIKE: NOTHING MEASURES A SUBJECT BOX, AND NOTHING IS GOING TO ──────
//
// `assets.geometry` holds `{width, height, format}` read out of an image header
// (src/lib/assets/measure.ts) and no more. `content` — a correction to the
// MEASURED subject box — therefore had a consumer and no producer:
// `parseContent` (src/lib/editor/drag-geometry.ts) has always answered "the
// whole picture" because no renderer published `data-content`.
//
// Three ways to give it one were weighed, and the answer is NEITHER, THIS
// CYCLE:
//
//   A HEURISTIC over the pixels — a trim threshold, an edge-energy pass — needs
//   a DECODER. src/lib/assets/measure.ts exists precisely because a header can
//   be read in a page of code with no native binary; a subject box cannot, and
//   the honest options are a native codec in the upload path or a full JPEG
//   decoder in JavaScript. The upload path runs on the same 2GB machine that is
//   already killed by two Chromiums at once (src/lib/render/pdf.ts), and a TIFF
//   from a repro house is the common case here. ARCHITECTURE.md also lists
//   "heuristics that approximate a judgement a model now makes directly" under
//   what is deliberately absent, and names the predecessor's finding: two
//   automatic-correction features shipped and found almost nothing to correct,
//   because the demo photographs were already straight and already neutral.
//
//   A VISION CALL is the thing that rule points at, and it is the right answer
//   LATER rather than a cheaper one now. Principle 9's corollary is that a
//   machine proposal is not an edit: it lands in `overrides` with `decided_by`
//   null, and `listOverrides` already filters those out, so the proposal half
//   of the mechanism exists and the PROPOSER does not — no queue, no rejection
//   memory, no cost ceiling, no place in the UI to accept one. Building the
//   model call without those is building the half that cannot be turned off.
//
//   NEITHER, which is what shipped. What it costs, exactly:
//
//     `content` KEEPS ITS FEATURE and loses its automation. A specialist who
//     can see the plate states the subject box; the renderer publishes it as
//     `data-content`; `parseContent` and `subjectRect` — already written,
//     already tested, never yet fed — turn it into the selection ring's box.
//     The key was never "the machine's answer, correctable"; it was "a
//     correction to the measured box", and with nothing measured it is simply
//     the box. That is a smaller feature and not a broken one.
//
//     `straightenDeg` COSTS NOTHING. A straighten is a manual correction by
//     construction (principle 9 again: the value the automation will one day
//     write has to be a value a person can already set, which is the whole
//     reason this key exists before any leveller does). What a subject box
//     would have bought is the PIVOT: the predecessor turns the picture about
//     the subject's centre so that an off-centre work does not travel across
//     the page. Here the pivot is the plate's centre, and `object-position`
//     follows the subject box when there is one — so a plate with a stated
//     subject behaves as the predecessor's does, and a plate without one
//     behaves the way every photo editor's straighten does.
//
//     THE PLATE'S RESOLUTION VERDICT is the one thing genuinely lost, and it is
//     lost to a different absence. See src/lib/polish/plate-note.ts.
//
// ── ONE DIVERGENCE FROM THE PREDECESSOR, NAMED BECAUSE IT IS A DEFECT ───────
//
// A straightened picture is sized LARGER THAN ITS PLATE and clipped, because
// covering a rectangle that is turning inside itself is what a straighten is.
// `measurePart` (src/components/preview-canvas.tsx:789) takes the plate's
// `<img>` box as the picture's box, so on a straightened plate it measures a
// rectangle bigger than the paper shows. The predecessor met this exactly and
// answered it with a `.plate-turn` wrapper that both consumers query by name.
// The equivalent fix here is one line in `measurePart`, and that file belongs
// to another agent this cycle — so it is written down rather than reached for.
// Unstraightened plates, which is every plate today, are unaffected.

import type { CatalogueDocument, DocSlot } from "@/lib/engine/derive";
import {
  GRADE_KEYS,
  gradeValue,
  type GroundLevel,
  type GroundTint,
  type PlateGrade,
  type PlateTreatment,
} from "@/lib/engine/plate";

// ── The grounds, as colour ───────────────────────────────────────────────────
//
// THREE NUMBERS AND A RULE, not eighteen hexes. A ground is a level crossed
// with a tint, and writing the nine products out would be nine chances for one
// of them to stop being the thing the rule says it is. The rule is: a ground is
// an EQUAL-CHANNEL grey at its level, and a tint moves red and blue apart by
// the level's step, leaving green — and therefore most of the luminance —
// alone. Warm is red up, blue down; cool is the reverse.
//
// THE STEP GROWS WITH DARKNESS because a fixed step does not read the same at
// both ends: the same three levels of separation that are plainly warm on a
// near-white are invisible on a mid grey. Re-measure by rendering the nine and
// looking at them side by side; the numbers below are the developer's neutral
// defaults, the way every other number in this renderer's stylesheet is, until
// a house's own taste is learned at runtime (ARCHITECTURE.md principle 4).

/**
 * The ground a sweep, a tone or a mount is drawn in.
 *
 * Exported with the rule that makes it a ladder, so a test can check a tone
 * against the construction rather than against a hex copied out of here — a
 * copy would agree with whatever this file says, including with a mistake.
 */
export const GROUND_GREY: Readonly<Record<GroundLevel, number>> = {
  light: 0xf2,
  mid: 0xe3,
  dim: 0xca,
};

/**
 * The ink a KEYLINE's rule is drawn in — a different ladder, deliberately.
 *
 * A keyline is a LINE and not a field. Drawn at the ground ladder above, the
 * light step would be a rule the press cannot hold and the dim step would still
 * read as a smudge; a rule's three steps have to live where ink lives. So the
 * keyline's level means how heavy the line is rather than how bright the board
 * is, which is also what a specialist asking for a light keyline means.
 */
export const RULE_GREY: Readonly<Record<GroundLevel, number>> = {
  light: 0x9a,
  mid: 0x6a,
  dim: 0x2b,
};

/** How far apart a tint moves red and blue, per level. See the note above. */
const TINT_STEP: Readonly<Record<GroundLevel, number>> = { light: 3, mid: 5, dim: 7 };

const byte = (v: number): string => Math.min(255, Math.max(0, Math.round(v)))
  .toString(16)
  .padStart(2, "0");

/** One ground or rule colour, from its ladder, its level and its tint. */
export function toneColour(
  ladder: Readonly<Record<GroundLevel, number>>,
  level: GroundLevel,
  tint: GroundTint,
): string {
  const grey = ladder[level];
  const step = tint === "neutral" ? 0 : TINT_STEP[level];
  const warm = tint === "warm" ? step : -step;
  return `#${byte(grey + warm)}${byte(grey)}${byte(grey - warm)}`;
}

/**
 * The colour ONE plate's ground is painted in, or null when it has no ground.
 *
 * A ground with no spec falls to mid neutral rather than to nothing. The spec
 * cannot outlive its ground (src/lib/engine/plate.ts) but a ground CAN outlive
 * its spec — three of the four grounds have no width, and a hand-written row
 * can carry a ground and no parameters at all — and a ground that refused to
 * paint without one would be a decision the specialist made and the page did
 * not show.
 */
export function groundColour(plate: PlateTreatment): string | null {
  const { ground, groundSpec } = plate;
  if (!ground) return null;
  const level = groundSpec?.level ?? "mid";
  const tint = groundSpec?.tint ?? "neutral";
  return toneColour(ground === "keyline" ? RULE_GREY : GROUND_GREY, level, tint);
}

// ── 拉直: the picture turns, the rectangle does not ──────────────────────────
//
// ── THE MODEL, AND WHY IT IS NOT THE PREDECESSOR'S ──────────────────────────
//
// There, the picture had already been PLACED by `contentFit` — the renderer
// knew the file's aspect, the window's aspect and where the subject sat, so it
// could compute the exact magnification that keeps the picture's own rectangle
// covered and emit it as a `scale()`. None of those three numbers exists here:
// a plate is `object-fit` inside a box CSS sizes, the document carries a
// content hash and not a measurement, and the plate's box in millimetres is a
// function of the stylesheet's gaps rather than of the template.
//
// So the cover is done by SIZING rather than by scaling, and it is exact.
// Rotate a W×H box by θ about the plate's centre; it contains the plate's w×h
// box exactly when the plate's box turned by −θ fits inside it, and the bounding
// box of a w×h rectangle turned by θ is
//
//     (w·cos θ + h·sin θ) by (w·sin θ + h·cos θ)
//
// — so a picture given exactly those two dimensions and turned by θ covers the
// plate with no slack and no guessed constant. Container query units are what
// make w and h expressible in CSS at all: with `container-type: size` on the
// plate's picture box, `100cqw` and `100cqh` ARE w and h, and the two lengths
// above are one `calc` each. The cosine and the sine travel as numbers on the
// element; nothing else about the plate has to be known.
//
// WHAT IT COSTS, SAID OUT LOUD: the picture goes from letterboxed to filling
// its box the moment it is straightened, and the outer parts of it leave the
// plate. That is not this implementation's accident — a tilted rectangle cannot
// be levelled inside its own box without either being cropped or being shrunk,
// and shrinking moves the plate's edge off the caption column every other lot
// on the spread shares. It is also what the word means in every photo editor.
// The bound at ±15° (src/lib/engine/plate.ts) is the bound on how much of the
// photograph that costs.
//
// ROUNDED TO SIX DECIMALS, which is the same resolution a stored frame carries
// and is far finer than the page: at 15° a change of 1e-6 in the cosine moves
// the edge of a 174mm plate by under a thousandth of a millimetre.

const TRIG_DP = 6;
const trig = (v: number): string => v.toFixed(TRIG_DP);

/** The two container-unit coefficients, the angle, and where the picture sits. */
export function straightenVars(plate: PlateTreatment): string[] {
  const deg = plate.straightenDeg;
  if (deg === undefined) return [];
  const rad = (Math.abs(deg) * Math.PI) / 180;
  // THE ABSOLUTE ANGLE, because a cover requirement is symmetric: turning left
  // and turning right need the same box, and a negative sine would ask for a
  // picture narrower than the plate.
  const vars = [`--tc:${trig(Math.cos(rad))}`, `--ts:${trig(Math.sin(rad))}`, `--td:${deg.toFixed(2)}deg`];
  // WHERE THE CROP FALLS. With no subject box the picture is centred, which is
  // what `object-position`'s own default would do and is stated anyway so that
  // a later rule changing the default cannot silently move every plate. With
  // one, the crop keeps the SUBJECT'S centre, which is the predecessor's pivot
  // arrived at through the one knob CSS offers — an off-centre work then stays
  // where the specialist put it instead of swinging across the page.
  const c = plate.content;
  const pos = c
    ? [(c.x + c.w / 2) * 100, (c.y + c.h / 2) * 100]
    : [50, 50];
  vars.push(`--tx:${pos[0]!.toFixed(4)}%`, `--ty:${pos[1]!.toFixed(4)}%`);
  return vars;
}

// ── 調色: five numbers, one filter ───────────────────────────────────────────
//
// Ported from the predecessor's src/lib/render/plate-grade.ts, whose comments
// carry the measurements behind every constant. What is repeated here is only
// what a reader of THIS file needs to check the arithmetic against the output.

/** The luma coefficients SVG's own `feColorMatrix type="saturate"` is defined
 *  in terms of. Named here because the vibrance below leans on that definition
 *  and a different set would make the mask and the boost disagree. */
const LUMA_R = 0.213;
const LUMA_G = 0.715;
const LUMA_B = 0.072;

/**
 * How far ±100 on 暖冷 moves the red and blue gains — 0.25.
 *
 * The largest cast a scanned auction plate plausibly carries. Larger would put
 * the useful part of the axis in its first fifth, where a five-step ladder
 * cannot land accurately. It also fixes the resolution: one unit is a gain
 * change of 0.0025, which on a mid-grey is about a third of an 8-bit level —
 * which is why the stored value is an integer.
 */
const CAST_WARM_GAIN = 0.25;

/**
 * The same for 綠洋紅 — 0.15, and deliberately smaller.
 *
 * Not timidity. The green/magenta vector puts twice the excursion on green as
 * on red and blue, so 0.15 here already moves green as far as 0.25 moves red.
 * Matching the numbers would make "+50" mean two different sizes of correction
 * on two controls in one row, which is a row a specialist cannot learn.
 */
const CAST_GREEN_GAIN = 0.15;

/** How far 鮮豔 ±100 moves the saturation of a FULLY NEUTRAL pixel — 0.6, and
 *  it falls to zero as the pixel's own chroma rises. That fall is the whole
 *  difference between this and a saturation control. */
const VIBRANCE_GAIN = 0.6;

/**
 * The per-channel gains that neutralise a cast, LUMA-PRESERVING.
 *
 * A cast correction that is not luma-normalised is also a brightness change,
 * and the specialist then has to undo the brightness with the tonal axis — two
 * controls fighting over one number. Dividing through by the luma the raw gains
 * would give a neutral means 暖冷 changes a mid-grey's hue and leaves its
 * lightness alone.
 *
 * warm is (+1, 0, −1): red up, blue down, green untouched — what warm and cool
 * ARE in an opponent space. green is (+½, −1, +½), and the half is what keeps
 * it ORTHOGONAL to the warm vector in the red/blue plane, so moving one control
 * cannot introduce the cast the other one exists to remove.
 *
 * EXACTLY UNITY WHEN NEITHER AXIS IS SET, rather than a normalisation that
 * happens to land near it: the luma coefficients sum to 1 in decimal and not in
 * binary, so dividing through returns 1.0000000000000002 — harmless in the
 * arithmetic and not harmless in emitted markup, where a tone-only correction
 * would carry a diagonal that read differently between two builds.
 */
export function gradeChannelGains(grade: PlateGrade): [number, number, number] {
  const w = gradeValue(grade, "warm") / 100;
  const t = gradeValue(grade, "green") / 100;
  if (w === 0 && t === 0) return [1, 1, 1];
  const raw: [number, number, number] = [
    1 + CAST_WARM_GAIN * w + CAST_GREEN_GAIN * t * 0.5,
    1 - CAST_GREEN_GAIN * t,
    1 - CAST_WARM_GAIN * w + CAST_GREEN_GAIN * t * 0.5,
  ];
  const luma = LUMA_R * raw[0] + LUMA_G * raw[1] + LUMA_B * raw[2];
  // Unreachable for any value the clamp permits, and guarded anyway: the
  // alternative to a guard here is an Infinity in a filter attribute in a
  // client's PDF.
  if (!(luma > 0.01)) return [1, 1, 1];
  return [raw[0] / luma, raw[1] / luma, raw[2] / luma];
}

/**
 * The cast and the tonal range as ONE 4×5 matrix, row-major.
 *
 * THEY COMPOSE INTO A DIAGONAL, which is why they share a primitive:
 *   out_c = gain_c · (in_c − black) / (white − black)
 * is a per-channel slope and a per-channel offset, exactly the columns a
 * `feColorMatrix` row has room for. Two primitives would be two rasterisation
 * passes and two roundings to 8 bits for a result one pass computes exactly.
 *
 * THE ORDER IS TONE FIRST, THEN CAST, AND IT IS PHYSICAL. The black point is
 * veiling flare — light scattered inside the scanner, an ADDITIVE term. The
 * cast is the illuminant, a MULTIPLICATIVE one. The addition has to come off
 * before the multiplication, or the correction multiplies the flare along with
 * the picture. The other order is representable in the same matrix and is wrong
 * by gain·flare, which on a thirty-level flare at a 1.2 gain is six levels of
 * unremovable colour in the shadows.
 *
 * ALPHA IS THE IDENTITY ROW, deliberately: a colour correction has nothing to
 * say about transparency, and the vibrance chain below relies on nothing
 * upstream having touched it.
 */
export function gradeMatrix(grade: PlateGrade): number[] {
  const [gr, gg, gb] = gradeChannelGains(grade);
  const black = gradeValue(grade, "black") / 255;
  const white = gradeValue(grade, "white") / 255;
  // The clamp guarantees white > black; a hand-built grade reaching here another
  // way falls back to the full range rather than dividing by zero.
  const span = white - black > 1e-6 ? white - black : 1;
  const a = [gr / span, gg / span, gb / span];
  const o = [(-gr * black) / span, (-gg * black) / span, (-gb * black) / span];
  return [
    a[0]!, 0, 0, 0, o[0]!,
    0, a[1]!, 0, 0, o[1]!,
    0, 0, a[2]!, 0, o[2]!,
    0, 0, 0, 1, 0,
  ];
}

/** Does the cast/tone half of this grade say anything at all? */
export function gradeMatrixIsIdentity(m: readonly number[]): boolean {
  return (
    Math.abs(m[0]! - 1) < 1e-9 &&
    Math.abs(m[6]! - 1) < 1e-9 &&
    Math.abs(m[12]! - 1) < 1e-9 &&
    Math.abs(m[4]!) < 1e-9 &&
    Math.abs(m[9]!) < 1e-9 &&
    Math.abs(m[14]!) < 1e-9
  );
}

/** The saturation excursion 鮮豔 asks for, at zero chroma. 0 is neutral. */
export function gradeVibranceK(grade: PlateGrade): number {
  return (gradeValue(grade, "vibrance") / 100) * VIBRANCE_GAIN;
}

/** Every output channel set from ONE input channel, alpha forced opaque — the
 *  greyscale split the max/min chain below needs. */
function channelSplit(index: 0 | 1 | 2): string {
  const row = [0, 0, 0, 0, 0];
  row[index] = 1;
  return [...row, ...row, ...row, 0, 0, 0, 0, 1].join(" ");
}

const OPAQUE_IDENTITY = "1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 0 1";
const OPAQUE_INVERT = "-1 0 0 0 1  0 -1 0 0 1  0 0 -1 0 1  0 0 0 0 1";

/**
 * The vibrance, as SVG filter primitives.
 *
 * A MATRIX CANNOT EXPRESS A VIBRANCE, and that is the whole problem. A
 * saturation is out = L + s·(in − L) for a CONSTANT s; a vibrance is the same
 * expression with s a function of the pixel's own chroma, and a matrix is by
 * construction chroma-independent. Shipping the matrix alone would mean
 * shipping blanket saturation under the name vibrance — a control that lies
 * about what it does, which is this vocabulary's most expensive recurring
 * defect. Measured on the predecessor's corpus: at +50 a blanket saturation
 * takes a vivid 220,30,30 to 255,10,10, clipped and with the artwork's
 * modelling gone, where this chain takes it to 229,25,25.
 *
 * So the mask is built from primitives that do exist:
 *   out = (1 − c)·saturate(1+k)(in) + c·in,   c = max(rgb) − min(rgb)
 * At c = 0 the boost is applied whole and a neutral is untouched anyway; at
 * c = 1 the weight is zero and a fully saturated pixel comes back exactly as it
 * went in. `max` and `min` are not linear, so `feColorMatrix` cannot compute
 * them — but `feBlend mode="lighten"` and `mode="darken"` ARE per-channel max
 * and min, and three greyscale splits through four blends give both.
 *
 * TWO THINGS THAT WENT WRONG FIRST IN THE PREDECESSOR, BOTH SILENT, both
 * carried here because the fix is invisible without the reason:
 *
 *   Computing c directly with `k2=1 k3=-1` runs the arithmetic on ALPHA too, so
 *   the result has alpha 0 — and `feColorMatrix`, specified on
 *   non-premultiplied values, un-premultiplies it and destroys the mask. The
 *   symptom was the whole filter collapsing to blanket saturation IN THE PDF
 *   while the browser looked right. So the chain computes KEEP = 1 − c with
 *   `k4=1`, which lands alpha back on 1, and inverts THAT.
 *
 *   `feComposite arithmetic` multiplies PREMULTIPLIED values, so a product of
 *   two images is wrong by a factor of alpha wherever alpha is not 1 — the
 *   antialiased edge of a 去背 cut-out. The two `OPAQUE_IDENTITY` matrices
 *   strip alpha off the operands and the closing `operator="in"` masks the
 *   source's own alpha back on.
 *
 * SIXTEEN PRIMITIVES, and a plate corrected only for cast and tone pays ONE.
 * That is not an optimisation, it is this file's rule: nothing is emitted for a
 * decision nobody made.
 */
function vibrancePrimitives(k: number, source: string): string[] {
  return [
    `<feColorMatrix type="saturate" values="${(1 + k).toFixed(4)}" in="${source}" result="S"/>`,
    `<feColorMatrix type="matrix" values="${OPAQUE_IDENTITY}" in="S" result="SO"/>`,
    `<feColorMatrix type="matrix" values="${OPAQUE_IDENTITY}" in="${source}" result="IO"/>`,
    `<feColorMatrix type="matrix" values="${channelSplit(0)}" in="${source}" result="CR"/>`,
    `<feColorMatrix type="matrix" values="${channelSplit(1)}" in="${source}" result="CG"/>`,
    `<feColorMatrix type="matrix" values="${channelSplit(2)}" in="${source}" result="CB"/>`,
    `<feBlend mode="lighten" in="CR" in2="CG" result="MX1"/>`,
    `<feBlend mode="lighten" in="MX1" in2="CB" result="MX"/>`,
    `<feBlend mode="darken" in="CR" in2="CG" result="MN1"/>`,
    `<feBlend mode="darken" in="MN1" in2="CB" result="MN"/>`,
    `<feComposite in="MN" in2="MX" operator="arithmetic" k1="0" k2="1" k3="-1" k4="1" result="KEEP"/>`,
    `<feColorMatrix type="matrix" values="${OPAQUE_INVERT}" in="KEEP" result="LIFT"/>`,
    `<feComposite in="KEEP" in2="SO" operator="arithmetic" k1="1" k2="0" k3="0" k4="0" result="A"/>`,
    `<feComposite in="LIFT" in2="IO" operator="arithmetic" k1="1" k2="0" k3="0" k4="0" result="B"/>`,
    `<feComposite in="A" in2="B" operator="arithmetic" k1="0" k2="1" k3="1" k4="0" result="SUM"/>`,
    `<feComposite in="SUM" in2="SourceGraphic" operator="in"/>`,
  ];
}

/**
 * The filter's id for one lot's plate.
 *
 * ONE PLATE PER LOT in every document this engine derives (`derive` reads
 * `images[0]` and no more), so the lot is enough to be unique. SANITISED rather
 * than escaped, because this is an id in a URL fragment and not text: a lot id
 * is a uuid today and the filter would work; the day it is not, an id built
 * from characters CSS cannot parse would silently drop the correction, which is
 * the one failure mode a colour feature must not have.
 */
export function gradeFilterId(lotId: string): string {
  return `g${lotId.replace(/[^A-Za-z0-9_-]/g, "-")}`;
}

/**
 * One plate's whole correction, as an inline `<svg>` carrying one `<filter>`.
 *
 * BESIDE THE PICTURE rather than in a document-level `<defs>`. The tidier
 * design collects every filter at the top of the document; it is refused
 * because a graded plate should carry its own definition wherever it goes — a
 * placed part is lifted out of its entry and emitted after the live area
 * (src/lib/render/html.ts), and a definition that had to travel with it would
 * be a second thing to remember.
 *
 * THE FILTER REGION IS THE ELEMENT, exactly. SVG's default is
 * −10%/−10%/120%/120%, which would rasterise a border of nothing around every
 * plate at print resolution and — because the chain ends masked against the
 * source — change nothing visible for the cost.
 */
export function gradeFilterSvg(lotId: string, grade: PlateGrade): string {
  const m = gradeMatrix(grade);
  const k = gradeVibranceK(grade);
  const hasMatrix = !gradeMatrixIsIdentity(m);
  const source = hasMatrix ? "G" : "SourceGraphic";
  const prims: string[] = [];
  if (hasMatrix) {
    prims.push(
      `<feColorMatrix type="matrix" values="${m
        .map((v) => Number(v.toFixed(6)))
        .join(" ")}"${k !== 0 ? ` result="G"` : ""}/>`,
    );
  }
  if (k !== 0) prims.push(...vibrancePrimitives(k, source));
  if (prims.length === 0) return "";
  return (
    `<svg class="grade" aria-hidden="true" focusable="false">` +
    `<filter id="${gradeFilterId(lotId)}" color-interpolation-filters="sRGB" ` +
    `x="0" y="0" width="100%" height="100%">` +
    prims.join("") +
    `</filter></svg>`
  );
}

// ── What the plate element carries ───────────────────────────────────────────

/**
 * Whether a URL is safe to put inside a CSS `url()`.
 *
 * The banded plate below is the only thing in this renderer that puts an asset
 * reference into CSS rather than into an attribute, and CSS is a second parser
 * with a second set of terminators. Both resolvers produce a known shape —
 * `/api/assets/<hash>` for the preview, `data:<mime>;base64,<payload>` for the
 * PDF (src/lib/render/html.ts's `AssetResolver`) — and neither can contain a
 * quote, a parenthesis, a backslash or whitespace. So this asks rather than
 * escapes: a reference that is not one of those two shapes does not go into a
 * stylesheet at all, and the plate falls back to a plain picture.
 */
export function cssSafeUrl(url: string): boolean {
  return /^(?:\/api\/assets\/[A-Za-z0-9._-]+|data:[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+;base64,[A-Za-z0-9+/=]+)$/.test(
    url,
  );
}

/**
 * The attributes a polished plate publishes.
 *
 * PUBLISHED RATHER THAN INFERRED, which is this project's standing rule and the
 * one it has paid for most often: three surfaces need to know what a plate was
 * treated with — the panel that shows the control, an audit counting how many
 * plates carry a correction, and a person reading print-mode HTML against what
 * they pressed — and none of them should have to parse a CSS transform or a
 * colour matrix to find out. A grade in particular MOVES NO RECTANGLE, so a
 * regression that dropped every correction in the book would leave every
 * geometric number identical and every one of those three blind.
 *
 * `data-content` is the one that is not only an audit: `parseContent` and
 * `subjectRect` (src/lib/editor/drag-geometry.ts) read it to ring the ARTWORK
 * rather than the reserved box, and this is the first renderer to emit it.
 *
 * Six decimals on the subject box, the stored resolution; two on the angle, the
 * stored resolution; whole numbers on the grade, likewise — so a reader that
 * parses an attribute and one that parses the emitted CSS cannot disagree.
 */
export function plateAttrs(plate: PlateTreatment): string {
  const out: string[] = [];
  if (plate.picture) out.push(` data-picture="${plate.picture}"`);
  if (plate.ground) out.push(` data-ground="${plate.ground}"`);
  if (plate.bands !== undefined) out.push(` data-bands="${plate.bands}"`);
  if (plate.straightenDeg !== undefined) {
    out.push(` data-straighten="${plate.straightenDeg.toFixed(2)}"`);
  }
  if (plate.content) {
    const f = (v: number): string => v.toFixed(6);
    const c = plate.content;
    out.push(` data-content="${f(c.x)},${f(c.y)},${f(c.w)},${f(c.h)}"`);
  }
  if (plate.grade) {
    // FIVE INTEGERS IN ORDER, including the neutral ones, so a reader never has
    // to know which components were stored — and unsigned, because this is a
    // machine-readable attribute and a leading "+" is one more thing to get
    // wrong.
    out.push(
      ` data-grade="${GRADE_KEYS.map((k) => gradeValue(plate.grade, k)).join(",")}"`,
    );
  }
  return out.join("");
}

/** Does this plate need the field behind it removed? See POLISH_STYLES. */
export function plateClass(plate: PlateTreatment): string {
  return plate.picture === "cutout" ? " plate--cutout" : "";
}

/**
 * The picture box's classes and inline custom properties, or null when this
 * plate needs no box of its own.
 *
 * Returns null — rather than an empty wrapper — for a plate whose only
 * treatment is `picture: "original"`, because that treatment paints nothing:
 * it is a specialist recording that they looked and left it alone, which the
 * attribute says and the page must not.
 */
export function pictureBox(
  plate: PlateTreatment,
  lotId: string,
  url: string,
): { cls: string; style: string; banded: boolean } | null {
  const ground = groundColour(plate);
  const turned = plate.straightenDeg !== undefined;
  const banded = plate.bands !== undefined && plate.bands > 1 && cssSafeUrl(url);
  const graded = plate.grade !== undefined;
  if (!ground && !turned && !banded && !graded && plate.picture !== "cutout") return null;

  // ── PASSAGES AND A TURN CANNOT BOTH BE PAINTED, AND PASSAGES WIN ──────────
  //
  // Not a preference. A passage is a WINDOW onto a background image — that is
  // what lets twelve of them share one copy of the file — and CSS cannot turn
  // a background. The alternative was twelve turned img elements, which is
  // twelve copies of a plate in the PDF to honour a straighten on a work that
  // is being cut into strips because it is five metres long and a hundredth
  // of a degree is invisible on a 7mm band.
  //
  // BOTH ATTRIBUTES ARE STILL PUBLISHED, because both are stored decisions and
  // dropping one would tell a panel the specialist had not made it. The panel
  // says which one the page is obeying (src/components/polish-panel.tsx), so
  // the thing a reader could otherwise be misled by is stated on the screen
  // rather than hidden in this branch.
  const cls = [
    "pic",
    ground ? `pic--${plate.ground}` : "",
    turned && !banded ? "pic--turn" : "",
    banded ? "pic--bands" : "",
    graded ? "pic--grade" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const vars: string[] = [];
  if (ground) vars.push(`--pg:${ground}`);
  if (plate.ground === "keyline") {
    // THE ONE MEASUREMENT IN THE WHOLE TREATMENT THAT IS IN REAL UNITS, and it
    // stays in them: a keyline is a printed rule, the specialist set it in
    // millimetres, and converting it to a share of the plate would make the
    // same choice print at two widths on a four-up and a nine-up page.
    vars.push(`--pw:${(plate.groundSpec?.widthMm ?? 0.5).toFixed(2)}mm`);
  }
  if (turned && !banded) vars.push(...straightenVars(plate));
  if (banded) {
    vars.push(`--pi:url('${url}')`, `--pspan:${(plate.bands! * 100).toFixed(0)}%`);
  }
  if (graded) vars.push(`--pf:url(#${gradeFilterId(lotId)})`);
  return { cls, style: vars.join(";"), banded };
}

/**
 * The passages an ultra-wide work is cut into.
 *
 * ONE ASSET REFERENCE FOR ALL OF THEM, declared once as `--pi` on the box and
 * read by every band. The obvious build gives each passage its own `<img>`, and
 * on the PDF path that is the plate's `data:` URI repeated up to twelve times —
 * a 6MB scan becoming 72MB of document, per lot, inside the single string the
 * export already has a ceiling on (src/app/events/[id]/catalogue/pdf/route.ts).
 * A custom property inherits, so the URI exists once and the bands are twelve
 * empty elements.
 *
 * EACH PASSAGE IS A WINDOW ONTO ONE HORIZONTAL SLICE. The picture is laid out
 * `bands` times as wide as the box, so a passage sees a `1/bands` share of its
 * width, and `background-position` steps from one end to the other. The
 * position is computed HERE rather than in `calc()` because the expression
 * divides by `bands − 1` and the single-band case would be a division by zero
 * inside a stylesheet, where it is silent.
 */
export function bandMarkup(bands: number): string {
  const out: string[] = [];
  for (let i = 0; i < bands; i++) {
    const at = bands > 1 ? (i / (bands - 1)) * 100 : 50;
    out.push(`<span class="band" style="--at:${at.toFixed(4)}%"></span>`);
  }
  return out.join("");
}

/** Has anything in this document asked for polish? */
export function documentIsPolished(doc: CatalogueDocument): boolean {
  return doc.pages.some((page) => page.slots.some((slot) => slotNeedsPolish(slot)));
}

/**
 * Does this slot need anything from this file?
 *
 * A treatment with no photograph to apply it to does NOT: the plate is an empty
 * dashed box, there is nothing to ground, turn, cut or correct, and emitting
 * the block for it would put a stylesheet into a document that paints none of
 * it. The attributes are still published, because the decision was still made.
 */
function slotNeedsPolish(slot: DocSlot): boolean {
  if (!slot.plate || !slot.image) return false;
  const p = slot.plate;
  return (
    p.ground !== undefined ||
    p.straightenDeg !== undefined ||
    p.grade !== undefined ||
    p.picture === "cutout" ||
    (p.bands !== undefined && p.bands > 1)
  );
}

/**
 * The block of CSS a polished document carries, and NOTHING for one that is
 * not.
 *
 * ── WHY IT IS A CONSTANT AND NOT A GENERATOR ────────────────────────────────
 *
 * Every number that differs per plate is a custom property on the element, so
 * this string is the same in every document that has it. That is what keeps the
 * conditional honest: a reader comparing two polished catalogues is comparing
 * their plates, not their stylesheets, and a reader comparing a polished one to
 * an unpolished one sees exactly this block and nothing else.
 *
 * ── THE GREYS ARE NOT IN IT ─────────────────────────────────────────────────
 *
 * golden.test.ts holds the stylesheet to a closed set of sixteen house greys,
 * and a ground is a colour that is not one of them. It is not smuggled past
 * that census by living in an attribute: it is a per-plate value the way a
 * frame's percentage is, it is chosen by a specialist rather than by this file,
 * and the sixteen are the ones THIS FILE picks for every catalogue whether
 * anyone asked or not. The two `color-mix` derivations below are the only
 * colour this file states about a ground, and both are stated in terms of the
 * ground the specialist chose.
 *
 * ── AND IT MUST PRINT ───────────────────────────────────────────────────────
 *
 * `print-color-adjust: exact`, both spellings. Chromium's own `page.pdf()` has
 * been measured to carry backgrounds through without it, and the HTML export is
 * printed by a browser this project does not choose — a ground that silently
 * drops on somebody's press is the failure this whole tranche is about.
 */
export const POLISH_STYLES = `

  /* ── A PLATE SOMEBODY POLISHED ────────────────────────────────────────────
     Emitted only into a document that carries one. The box below IS the plate's
     box: it stretches to the element that holds the picture in all three
     arrangements, so every rule here is written against one rectangle and none
     of them has to know whether it is inside a grid cell, a sheet or a table
     cell that a person has lifted onto the page. */
  .pic {
    position: relative; flex: 1 1 0%; align-self: stretch;
    min-width: 0; min-height: 0; overflow: hidden;
    display: flex; align-items: center; justify-content: center;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  /* ── EVERY PICTURE RULE IS QUALIFIED page-plate, AND THAT IS NOT NOISE ────
     The rules this block has to beat are the arrangements' own, and they are
     SPECIFIC: the grid's rule for a plate's img is (0,2,1) and the table's
     rule for a LIFTED plate's img is (0,3,1), where an unqualified .pic img
     is (0,1,1). Order cannot save a less specific selector, so a straightened
     plate's max-width:none was put straight back to 100% by the grid — the
     picture sized itself to its box instead of to the turn, and the corners
     of the plate showed paper. Measured by writing it unqualified first and
     reading the computed style. Three classes and one element ties the worst
     of them and wins on order, which is what the block being last is for.

     (And no backticks anywhere in this string, including in a comment: it is
     a template literal, so one ends it mid-rule. html.ts's stylesheet says
     the same thing twice and it has now cost a fourth debugging session.) */
  .page .plate .pic img {
    max-width: 100%; max-height: 100%; object-fit: contain; display: block;
  }
  /* 去背: the plate's own field comes off so the object stands on the paper.
     It does NOT cut the photograph's background out — nothing in this system
     produces a cut-out derivative and CSS cannot make one. See the panel's own
     wording, which says the same thing to the specialist.

     QUALIFIED BY page FOR THE CASCADE AND NOT FOR THE SELECTOR. The field it
     removes is set by the grid's own two-class rule; an unqualified
     plate--cutout is one class, loses on specificity wherever it stands, and
     leaves the grey field on a cut-out object. Two classes here ties, and
     this block is emitted after the arrangements, so it wins on order. */
  .page .plate--cutout { background: transparent; }
  /* A flat ground, and the studio sweep's falloff. The mix is stated in oklab
     because mixing toward black in sRGB shifts a warm tone toward brown; in
     oklab it stays the same colour, darker. */
  .pic--tone { background: var(--pg); }
  .pic--sweep {
    background: radial-gradient(120% 100% at 50% 0%,
      var(--pg) 0%, color-mix(in oklab, var(--pg) 78%, black) 100%);
  }
  /* 裱框: a board with the work inset, a hairline at the opening and a hairline
     at the board's own edge. The inset is a SHARE of the plate and not a
     measurement, because a mat that did not scale with the plate would be
     wider than the picture at nine-up. */
  .pic--mount {
    padding: 6%; background: var(--pg);
    box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--pg) 62%, black);
  }
  .page .plate .pic--mount img { outline: 1px solid color-mix(in oklab, var(--pg) 62%, black); }
  /* A rule box with generous air between the rule and the work. The width is
     the specialist's, in millimetres, because that is what a press holds. */
  .pic--keyline { padding: 7%; border: var(--pw) solid var(--pg); }
  /* ── 拉直 ─────────────────────────────────────────────────────────────────
     The picture is given the exact bounding box of the plate turned by the
     angle, so turning it back covers the plate with no slack and no guessed
     constant. The two coefficients are the cosine and the sine of the angle;
     the container's own width and height are the other two terms, which is the
     only way CSS can be told what rectangle it is covering. */
  .pic--turn { container-type: size; }
  .page .plate .pic--turn img {
    position: absolute; left: 50%; top: 50%;
    width: calc(100cqw * var(--tc) + 100cqh * var(--ts));
    height: calc(100cqw * var(--ts) + 100cqh * var(--tc));
    max-width: none; max-height: none;
    object-fit: cover; object-position: var(--tx) var(--ty);
    transform: translate(-50%, -50%) rotate(var(--td));
  }
  /* ── 段數: an ultra-wide work, cut into passages ──────────────────────────
     Each band is a window onto one horizontal slice of the same picture, which
     is declared ONCE as a custom property on the box. Twelve copies of a plate
     would be twelve copies of its bytes in the PDF. */
  .pic--bands { display: grid; grid-auto-rows: 1fr; gap: 2%; }
  .pic--bands .band {
    background-image: var(--pi); background-repeat: no-repeat;
    background-size: var(--pspan) auto; background-position: var(--at) center;
  }
  /* ── 調色 ─────────────────────────────────────────────────────────────────
     On the PICTURE and never on the box, so a ground the house chose is not put
     through a correction aimed at a photograph. The filter itself travels
     beside the plate as an inline svg, taken out of flow so it is not a second
     flex item in the centring above. */
  .page .plate .pic--grade img, .page .plate .pic--grade .band { filter: var(--pf); }
  .grade { position: absolute; width: 0; height: 0; overflow: hidden; }`;
