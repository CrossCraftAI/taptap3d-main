// What a person may say about ONE PLATE — the vocabulary, its bounds, and the
// one reader both the write path and the read path go through.
//
// ── WHY THIS MOVED OUT OF THE DATA LAYER ────────────────────────────────────
//
// It lived in src/lib/data/overrides.ts, under a comment that said exactly when
// it should stop: "Nothing in this system renders them yet, so storage is their
// only reader, and inventing a field in the pure engine that no output consumes
// would be noise in the one module that has to stay readable."
//
// An output consumes them now. The renderer paints a ground, turns a picture
// inside its rectangle, cuts an ultra-wide work into passages and puts a plate
// through a colour correction, so the vocabulary the renderer switches on has to
// be the vocabulary storage validates against — which is the predecessor's own
// reason for declaring them in core, arrived at from the other direction.
//
// It is in the ENGINE rather than in the renderer because two outputs read it
// and neither may own it: the document carries a plate's treatment
// (src/lib/engine/derive.ts) and the renderer paints it (src/lib/render/html.ts,
// src/lib/render/plate-css.ts). src/lib/engine/frame.ts is the same shape for
// the same reason — one value, shared by the client, the server, the engine and
// the data layer, owned by none of them.
//
// src/lib/data/overrides.ts re-exports every name below, so nothing that
// imported them from there had to change.
//
// ── NO CSS AND NO ARITHMETIC OF THE PAGE HERE ───────────────────────────────
//
// This file says what a value MEANS and what it may be. What a ground looks
// like, what a turn does to the pixels and how a grade becomes a filter are the
// renderer's taste and the renderer's geometry, and they live in
// src/lib/render/plate-css.ts. The split is the predecessor's — core/layout held
// the vocabulary, render/ held the paint — and it is what lets this module be
// read by a data layer that must never import a stylesheet.

import { frameFromValue, roundFrame, type OverrideFrame } from "./frame";

/** What the plate IS: the photograph as supplied, or 去背 — cut out. */
export const PICTURE_TREATMENTS = ["original", "cutout"] as const;
export type PictureTreatment = (typeof PICTURE_TREATMENTS)[number];

/**
 * What sits behind or around the plate. ABSENT is 無 — there is no "none"
 * value, because a row that asserts nothing is a row that should not exist.
 *
 *   sweep     a studio ground with the soft falloff a curved paper roll gives.
 *   tone      a flat solid ground, from a curated set.
 *   mount     a passe-partout: a toned mat between hairlines and the picture.
 *   keyline   a thin rule box with generous air between the rule and the work.
 */
export const GROUNDS = ["sweep", "tone", "mount", "keyline"] as const;
export type Ground = (typeof GROUNDS)[number];

/** How bright the ground is — the specialist's own light / mid / dim. */
export const GROUND_LEVELS = ["light", "mid", "dim"] as const;
export type GroundLevel = (typeof GROUND_LEVELS)[number];

/** Its temperature. Three steps, not a colour picker: see the ladder's reason. */
export const GROUND_TINTS = ["neutral", "warm", "cool"] as const;
export type GroundTint = (typeof GROUND_TINTS)[number];

/**
 * The ground's parameters.
 *
 * ONE SHAPE FOR EVERY GROUND THAT TAKES PARAMETERS, rather than a backdrop spec
 * beside a keyline spec. The invariant that matters — a ground's parameters
 * cannot outlive its ground — is then one key to drop rather than two that can
 * be dropped inconsistently.
 */
export interface GroundSpec {
  level: GroundLevel;
  tint: GroundTint;
  /** The keyline's rule width in mm. Absent on every other ground. */
  widthMm?: number;
}

/** Narrower than this and the press loses the line; wider and it is a border. */
export const KEYLINE_MIN_MM = 0.25;
export const KEYLINE_MAX_MM = 2;

/**
 * Passages one ultra-wide work may be cut into.
 *
 * A sanity floor, not the rule that decides how many a scroll gets — that
 * belongs to whatever eventually paints them. This exists so a hand-edited row
 * cannot turn one plate into ten thousand.
 */
export const MAX_BANDS = 12;

/**
 * How far a plate's picture may be turned inside its own rectangle.
 *
 * Fifteen degrees, because straightening crops: the picture must still fill its
 * box after the turn, and at 15° on a 4:3 plate a quarter of the photograph is
 * already gone. A control that reached 45° would be offering to destroy the
 * plate with no warning in between. Stored to a hundredth of a degree, which is
 * the resolution an automatic leveller recovers and finer than a specialist can
 * see — 0.01° moves the corner of a 174mm plate by a sixth of a dot at 300dpi.
 */
export const STRAIGHTEN_MAX_DEG = 15;
const STRAIGHTEN_DP = 2;

/**
 * The step a nudge moves the angle by, and what SHIFT buys.
 *
 * A TENTH, and a HUNDREDTH with the modifier. The operation lives between about
 * −5° and +5°, so the predecessor's other meaning for Shift — snap to a 15°
 * ladder, which is what a person turning a stamp wants — would be absurd here;
 * the only meaning left is FINER, and the fine step is the stored resolution so
 * the control can reach every value the row can hold.
 *
 * Both are stated rather than one being the other divided, so the two numbers
 * can be read side by side and neither drifts into being a multiple of the
 * other by accident.
 */
export const STRAIGHTEN_STEP_DEG = 0.1;
export const STRAIGHTEN_FINE_DEG = 0.01;

/** Which grounds are drawn from a tone, and so carry a level and a tint. */
export function groundTakesTone(ground: Ground | undefined): boolean {
  return ground === "sweep" || ground === "tone" || ground === "keyline";
}

/** Only the keyline draws a line, so only the keyline has a width. */
export function groundTakesWidth(ground: Ground | undefined): boolean {
  return ground === "keyline";
}

// ── 調色: five numbers, three corrections ────────────────────────────────────
//
// Ported from the predecessor's core/layout/plate-grade.ts, whose argument is
// carried here in short and is worth reading there in full. The rule that
// produced it is the one this whole tranche obeys: THE VALUE THE AUTOMATION
// WILL WRITE MUST BE A VALUE A PERSON CAN ALREADY SET (principle 9). No
// automatic colour pass exists here and the spike below `parseContent` says why
// none is coming this cycle; the control is therefore the only writer, which is
// the same position 拉直 and 主體框 are in.
//
// Why the shapes are what they are:
//
//   the cast   TWO numbers, because a cast is two-dimensional. Every white
//              balance estimator returns a point in an opponent plane —
//              warm↔cool and green↔magenta — and one number could express only
//              half of a fluorescent cast, leaving the other half uncorrectable.
//
//   the range  TWO numbers, the BLACK POINT and the WHITE POINT, in the 0–255
//              levels a histogram is quoted in. A single "contrast" was the
//              cheaper design and is refused: a yellowed scan sits at roughly
//              30–230, and a symmetric slope about mid grey cannot state that.
//
//   vibrance   ONE number, and it is a vibrance rather than a saturation. The
//              difference is measured in src/lib/render/plate-css.ts, where the
//              arithmetic is.
//
// What is left out: no hue rotation, no per-hue adjustment, no midtone gamma,
// no colour-managed "correct to reality". The first two are retouching rather
// than correction; a gamma is a sixth number no automatic pass produces, so it
// would be a manual knob with no machine to correct; the last is an ICC problem
// this project does not fake.

/**
 * The five numbers, each present ONLY when it says something.
 *
 * ABSENCE AND NEUTRAL ARE ONE STATE, five times over — the rule `straightenDeg`
 * already follows. A catalogue nobody has graded renders byte-for-byte as it did
 * before this existed, and that is only true if "warm 0" and "no warm" produce
 * identical markup. `clampPlateGrade` drops every component that asserts
 * nothing and returns null when they all drop.
 *
 * ONE OBJECT AND NOT FIVE OVERRIDE KEYS, for `GroundSpec`'s reason: these are
 * five knobs on one question — what is wrong with this photograph's colour —
 * set together, cleared together, and undone together.
 */
export interface PlateGrade {
  /** 暖冷 — positive is WARMER (more red, less blue). ±100. */
  warm?: number;
  /** 綠洋紅 — positive is MAGENTA, negative is GREEN. ±100. */
  green?: number;
  /** 黑點 — the input level that becomes black. 0–254; 0 is neutral. */
  black?: number;
  /** 白點 — the input level that becomes white. 1–255; 255 is neutral. */
  white?: number;
  /** 鮮豔 — positive LIFTS muted colour and leaves vivid colour alone. ±100. */
  vibrance?: number;
}

export const GRADE_KEYS = ["warm", "green", "black", "white", "vibrance"] as const;
export type GradeKey = (typeof GRADE_KEYS)[number];

/** The extreme of the three AMOUNT axes — a percentage of a full correction. */
export const GRADE_AMOUNT_MAX = 100;
/** The extreme of the two TONAL axes — the levels of an 8-bit channel. */
export const GRADE_LEVEL_MAX = 255;
/** One ladder for all five axes: five controls that stepped differently would
 *  be a row nobody can learn. SHIFT buys the stored resolution, which is 1. */
export const GRADE_STEP = 5;
export const GRADE_FINE = 1;

/**
 * What each axis MEANS as a range and as a neutral, in one table.
 *
 * DECLARED ONCE because five places would otherwise each carry a copy: the
 * clamp, the nudge, the control's min and max, the panel's readout, and the
 * test that walks every axis. The `neutral` column is what makes "absence and
 * neutral are one state" a property of the data rather than of five hand-written
 * comparisons.
 */
export const GRADE_AXES: Readonly<
  Record<GradeKey, { min: number; max: number; neutral: number }>
> = {
  warm: { min: -GRADE_AMOUNT_MAX, max: GRADE_AMOUNT_MAX, neutral: 0 },
  green: { min: -GRADE_AMOUNT_MAX, max: GRADE_AMOUNT_MAX, neutral: 0 },
  // The two endpoints stop one level short of each other's ends, because a
  // black point AT white is not a strong correction, it is a division by zero.
  black: { min: 0, max: GRADE_LEVEL_MAX - 1, neutral: 0 },
  white: { min: 1, max: GRADE_LEVEL_MAX, neutral: GRADE_LEVEL_MAX },
  vibrance: { min: -GRADE_AMOUNT_MAX, max: GRADE_AMOUNT_MAX, neutral: 0 },
};

/** What each axis is CALLED, once, so the panel and a log cannot drift apart. */
export const GRADE_LABELS: Readonly<Record<GradeKey, string>> = {
  warm: "暖冷",
  green: "綠洋紅",
  black: "黑點",
  white: "白點",
  vibrance: "鮮豔",
};

/** One axis, rounded to the stored integer and bounded, or null for neutral. */
function gradeAxis(key: GradeKey, value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const { min, max, neutral } = GRADE_AXES[key];
  const n = Math.min(max, Math.max(min, Math.round(value)));
  return n === neutral ? null : n;
}

/**
 * What a stored grade MEANS: integers, bounded, neutral components dropped, and
 * null when the whole thing says nothing.
 *
 * ROUNDED TO INTEGERS, which is already finer than the sheet can hold. One unit
 * of an amount axis moves a mid-grey by about a third of an 8-bit level and one
 * unit of a tonal axis IS one level, so a stored tenth would be a digit the
 * printed page cannot express — and a control offering a precision the medium
 * cannot hold is the same lie as a control offering a colour the press cannot
 * print.
 *
 * CLAMPED RATHER THAN REFUSED, which is this vocabulary's standing rule: jsonb
 * is jsonb, and a read path that could refuse a stored value is a catalogue
 * nobody can open.
 *
 * AND THE TWO TONAL ENDPOINTS ARE PUT BACK IN ORDER. A black point at or above
 * the white point is a division by zero and prints as a hard two-tone
 * threshold. The WHITE point yields, because the black point is the one a
 * specialist sets deliberately — it is where the veiling flare is — and the
 * white point is the one an automatic pass is likeliest to have measured low on
 * a dark scan. Moving the measured one is the smaller lie.
 */
export function clampPlateGrade(raw: unknown): PlateGrade | null {
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const warm = gradeAxis("warm", record.warm);
  const green = gradeAxis("green", record.green);
  const vibrance = gradeAxis("vibrance", record.vibrance);
  let black = gradeAxis("black", record.black);
  let white = gradeAxis("white", record.white);
  const b = black ?? GRADE_AXES.black.neutral;
  const w = white ?? GRADE_AXES.white.neutral;
  if (b >= w) {
    const fixed = Math.min(GRADE_LEVEL_MAX, b + 1);
    white = fixed === GRADE_AXES.white.neutral ? null : fixed;
    black = b === GRADE_AXES.black.neutral ? null : b;
  }
  const out: PlateGrade = {
    ...(warm !== null ? { warm } : {}),
    ...(green !== null ? { green } : {}),
    ...(black !== null ? { black } : {}),
    ...(white !== null ? { white } : {}),
    ...(vibrance !== null ? { vibrance } : {}),
  };
  return Object.keys(out).length === 0 ? null : out;
}

/** The value in force on one axis — the stored number, or the axis's neutral. */
export function gradeValue(grade: PlateGrade | null | undefined, key: GradeKey): number {
  const v = grade?.[key];
  return typeof v === "number" ? v : GRADE_AXES[key].neutral;
}

/**
 * One axis changed, as a whole new grade — or null when the result says nothing.
 *
 * THE ONE MUTATOR, and it is here rather than in the panel because three
 * surfaces build the same object: the control, its undo, and the tests.
 * Reconstructing "everything else, but this one different" in three places is
 * how a fifth key gets forgotten in two of them.
 */
export function withGradeAxis(
  grade: PlateGrade | null | undefined,
  key: GradeKey,
  value: number | null,
): PlateGrade | null {
  const next: PlateGrade = { ...(clampPlateGrade(grade) ?? {}) };
  if (value === null) delete next[key];
  else next[key] = value;
  return clampPlateGrade(next);
}

/**
 * The value one keystroke away on one axis, in the direction asked.
 *
 * SNAPPED TO THE STEP, not merely added to it. A specialist who typed 37 and
 * then pressed + gets 40 rather than 42: the ladder is absolute, so pressing the
 * button from anywhere lands on a multiple of the step and no sequence of
 * presses can strand the value on a rung nobody can get back off. Rounding the
 * quotient rather than flooring it is what makes the first press from 37 go up
 * to 40 and the first press down go to 35 — the nearest rung in the direction
 * asked, never a rung skipped.
 */
export function nudgeGrade(
  key: GradeKey,
  value: number | null | undefined,
  direction: 1 | -1,
  step: number = GRADE_STEP,
): number | null {
  const { neutral } = GRADE_AXES[key];
  const from = gradeAxis(key, value) ?? neutral;
  if (!(step > 0) || !Number.isFinite(step)) return gradeAxis(key, from);
  const here = Math.round((from / step) * 1e6) / 1e6;
  const next = direction > 0 ? Math.floor(here) + 1 : Math.ceil(here) - 1;
  return gradeAxis(key, next * step);
}

/**
 * How a number is written where a person reads it.
 *
 * SIGNED ON THE THREE AMOUNT AXES and bare on the two tonal ones, which is the
 * difference between the two kinds of number rather than an inconsistency.
 * "+12" and "−12" are opposite corrections and a bare 12 on an axis whose
 * neutral is zero reads as a magnitude; 32 on the black point is a LEVEL, and
 * "+32" there would read as "thirty-two levels further", which is a different
 * and wrong statement.
 */
export function formatGradeValue(key: GradeKey, value: number): string {
  if (key === "black" || key === "white") return String(value);
  return `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value)}`;
}

/**
 * The angle as a person reads it.
 *
 * TWO DECIMALS, the stored resolution: a readout finer would invent digits, and
 * a readout coarser would round a 0.07° residue to 0.1 and leave a specialist
 * unable to tell an automatic answer from their own approximation of it.
 * SIGNED ALWAYS, because the sign is the whole content of the number — "0.70"
 * and "−0.70" are opposite corrections.
 */
export function formatStraightenDeg(deg: number | null | undefined): string {
  const d = straightenFromValue(deg);
  if (d === undefined) return "0.00";
  return `${d > 0 ? "+" : "−"}${Math.abs(d).toFixed(STRAIGHTEN_DP)}`;
}

/** The angle one nudge away, snapped to the step. `nudgeGrade`'s ladder. */
export function nudgeStraightenDeg(
  deg: number | null | undefined,
  direction: 1 | -1,
  step: number = STRAIGHTEN_STEP_DEG,
): number | null {
  const from = straightenFromValue(deg) ?? 0;
  if (!(step > 0) || !Number.isFinite(step)) return straightenFromValue(from) ?? null;
  const here = Math.round((from / step) * 1e6) / 1e6;
  const next = direction > 0 ? Math.floor(here) + 1 : Math.ceil(here) - 1;
  return straightenFromValue(next * step) ?? null;
}

const isOneOf = <T extends string>(list: readonly T[], value: unknown): value is T =>
  typeof value === "string" && (list as readonly string[]).includes(value);

/**
 * A stored ground spec, or null when what is there is not one.
 *
 * BOTH OR NEITHER for the level and the tint: a half-written spec is not a
 * smaller spec, it is a corrupt one, and defaulting the missing half would
 * invent a colour nobody chose. The WIDTH is different and the asymmetry is
 * deliberate — three of the four grounds have no width at all — so it is
 * carried when present, clamped, and simply absent otherwise.
 */
export function groundSpecFromValue(value: unknown, ground: Ground | undefined): GroundSpec | null {
  // A GROUND'S PARAMETERS CANNOT OUTLIVE ITS GROUND. Enforced on the way in AND
  // on the way out, because this is the one predicate both paths pass through:
  // a brightness with no ground is not work, it is a row asserting the colour
  // of a thing nobody is drawing, and left behind it would keep an otherwise
  // empty row alive and have this catalogue report an edit nobody made.
  if (!groundTakesTone(ground)) return null;
  if (typeof value !== "object" || value === null) return null;
  const { level, tint, widthMm } = value as Record<string, unknown>;
  if (!isOneOf(GROUND_LEVELS, level) || !isOneOf(GROUND_TINTS, tint)) return null;
  if (!groundTakesWidth(ground) || typeof widthMm !== "number" || !Number.isFinite(widthMm)) {
    return { level, tint };
  }
  return {
    level,
    tint,
    widthMm: Math.min(KEYLINE_MAX_MM, Math.max(KEYLINE_MIN_MM, widthMm)),
  };
}

/**
 * A stored straighten, or undefined when there is nothing to apply.
 *
 * CLAMPED RATHER THAN REFUSED. A value here has usually passed the write path,
 * but jsonb is jsonb and a hand-written statement or a restored backup can put
 * anything in it. A coarse angle is still an angle, so it is bounded and kept;
 * a read that could refuse a stored value is a catalogue nobody can open.
 * Rounded before the bound as well as by it, so 15.004 lands on 15.00 rather
 * than being clamped by a ten-thousandth of a degree.
 */
export function straightenFromValue(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const f = 10 ** STRAIGHTEN_DP;
  const rounded = Math.round(value * f) / f;
  const bounded =
    Math.round(Math.min(STRAIGHTEN_MAX_DEG, Math.max(-STRAIGHTEN_MAX_DEG, rounded)) * f) / f;
  return bounded === 0 ? undefined : bounded;
}

/** A stored passage count, or undefined. 1 IS A VALUE — see `PlateTreatment`. */
export function bandsFromValue(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isInteger(value)) return undefined;
  if (value < 1 || value > MAX_BANDS) return undefined;
  return value;
}

/**
 * Everything a person has said about one plate, as the DOCUMENT carries it.
 *
 * ── THE SAME KEYS AS THE STORED VALUE, AND THAT IS ON PURPOSE ───────────────
 *
 * This is not a projection with a different name for each field. It is the
 * plate-shaped subset of `OverrideValue`, so the thing the panel writes, the
 * thing the row holds and the thing the renderer paints are one vocabulary read
 * three times. A translation layer between storage and paint is where the
 * predecessor's `treatment`-versus-`picture` drift came from, and the cost of
 * that drift was a catalogue whose specialist's choice was silently dropped
 * until somebody re-derived it.
 *
 * `content` is here even though nothing in this system MEASURES a subject box.
 * See the header of src/lib/render/plate-css.ts for the spike that decided
 * that, and for what it costs.
 */
export interface PlateTreatment {
  picture?: PictureTreatment;
  ground?: Ground;
  groundSpec?: GroundSpec;
  /**
   * How many passages an ultra-wide work is cut into.
   *
   * 1 IS A VALUE, not an absence: it means "show this work whole across the
   * plate". Absence means "let whatever paints it decide", which today is the
   * renderer drawing one picture in one box.
   */
  bands?: number;
  /** Degrees, positive clockwise — the sense CSS `rotate()` uses. */
  straightenDeg?: number;
  /** The subject box, in fractions of the IMAGE. */
  content?: OverrideFrame;
  grade?: PlateGrade;
}

/**
 * Read the plate keys out of whatever is stored, or null when none are there.
 *
 * ONE READER FOR BOTH DIRECTIONS, which is what makes the round trip provable:
 * `overrideFromValue` normalises through this on the way in as well as on the
 * way out, so a value that survives a write is exactly the value that comes
 * back and there is no second predicate to drift from this one.
 *
 * Null rather than an empty object, so a caller can spread the answer without
 * putting an empty `plate: {}` onto a slot and changing the bytes of every
 * document that has no treatment on it.
 */
export function plateFromValue(record: Record<string, unknown>): PlateTreatment | null {
  const out: PlateTreatment = {};
  if (isOneOf(PICTURE_TREATMENTS, record.picture)) out.picture = record.picture;
  if (isOneOf(GROUNDS, record.ground)) out.ground = record.ground;
  const spec = groundSpecFromValue(record.groundSpec, out.ground);
  if (spec) out.groundSpec = spec;
  const bands = bandsFromValue(record.bands);
  if (bands !== undefined) out.bands = bands;
  const straighten = straightenFromValue(record.straightenDeg);
  if (straighten !== undefined) out.straightenDeg = straighten;
  // ROUNDED to the renderer's own resolution in the one place both paths pass
  // through, exactly as a page frame is — the number the renderer publishes on
  // `data-content` and the number the row holds are then the same number, and
  // two writes of one gesture do not differ in bytes nobody can see.
  const content = frameFromValue(record.content);
  if (content) out.content = roundFrame(content);
  const grade = clampPlateGrade(record.grade);
  if (grade) out.grade = grade;
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Is this treatment worth carrying at all?
 *
 * `picture: "original"` is the one value in the whole vocabulary that asserts
 * the default, and it is kept rather than dropped: a specialist who has looked
 * at a plate and decided it stays as supplied has made a decision, and the row
 * is what records that they made it. Everything else here is already
 * absent-when-neutral by construction.
 */
export function plateIsEmpty(plate: PlateTreatment | null | undefined): boolean {
  return !plate || Object.keys(plate).length === 0;
}
