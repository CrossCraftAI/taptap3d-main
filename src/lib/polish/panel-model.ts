// What the per-selection panel KNOWS, with no React in it.
//
// A MODULE AND NOT A COMPONENT, for the reason every other logic module in this
// repository gives: vitest runs `environment: "node"` with no jsdom, so a rule
// written inside a .tsx is a rule no test can read. Which tab is available,
// what a disabled tab says, and what patch a gesture produces are all
// decisions, and decisions belong where they can be asserted.
//
// ── THE PANEL WRITES PATCHES AND NOTHING ELSE ───────────────────────────────
//
// Every function below returns an `OverridePatch` — the shape
// src/lib/data/overrides.ts merges rather than replaces. That is not a
// convention, it is the whole reason that shape exists: one row holds every
// judgement about one (lot, field), so a panel that sent a whole value would
// erase the drag somebody committed a minute earlier, and the drag would erase
// the ground. A patch that names one key leaves the others alone, and an
// explicit null clears exactly one.
//
// ── AND IT WRITES THEM AGAINST `images` ─────────────────────────────────────
//
// Polish is for a PLATE. `images` is the field key the renderer paints a plate
// under and the key `derive` reads a treatment from, so a treatment written
// against any other field is a row about a thing that has no picture. The panel
// cannot produce one: `polishTargetOf` returns null for a text selection, and
// the tab is DISABLED WITH A REASON rather than hidden — a control that
// vanishes teaches nobody what it was for, and a specialist who selects a title
// and finds the Polish tab gone learns that the product is inconsistent rather
// than that polish is for plates.

import type { OverridePatch, OverrideValue } from "@/lib/data/overrides";
import {
  plateFromValue,
  GROUND_LEVELS,
  GROUND_TINTS,
  KEYLINE_MAX_MM,
  KEYLINE_MIN_MM,
  MAX_BANDS,
  STRAIGHTEN_FINE_DEG,
  STRAIGHTEN_MAX_DEG,
  STRAIGHTEN_STEP_DEG,
  groundTakesTone,
  groundTakesWidth,
  nudgeStraightenDeg,
  withGradeAxis,
  type GradeKey,
  type Ground,
  type GroundLevel,
  type GroundSpec,
  type GroundTint,
  type PictureTreatment,
} from "@/lib/engine/plate";

/** The one field key a treatment may be written against. See the header. */
export const PLATE_FIELD = "images";

/** The two tabs, in the order they are read. */
export const POLISH_TABS = ["settings", "polish"] as const;
export type PolishTab = (typeof POLISH_TABS)[number];

export interface TabState {
  id: PolishTab;
  label: string;
  enabled: boolean;
  /**
   * Why not, when not — shown, never swallowed.
   *
   * A SENTENCE ABOUT THE SELECTION and not about the product: "Polish is for a
   * photograph. This is the lot's title." tells a specialist what to select
   * next. "Unavailable" tells them the software is broken.
   */
  reason?: string;
}

/** What the panel is looking at. Structural, so it needs no editor import. */
export interface PanelSelection {
  lotId: string;
  field: string;
}

/**
 * The (lot, field) a treatment would be written against, or null when this
 * selection is not a plate.
 *
 * ONE PREDICATE, read by the tab state, by every patch builder's caller and by
 * the server action's guard. Three copies of "is this the plate?" is two places
 * for a treatment to reach a caption.
 */
export function polishTargetOf(
  selection: PanelSelection | null,
): { lotId: string; field: string } | null {
  if (!selection || selection.field !== PLATE_FIELD) return null;
  return { lotId: selection.lotId, field: PLATE_FIELD };
}

/**
 * The tabs for one selection.
 *
 * TWO REASONS A PLATE CANNOT BE POLISHED, and they are different sentences
 * because they need different actions. A caption row is the wrong SELECTION —
 * select the photograph. A lot with no photograph is the wrong LOT — go and
 * add one. Collapsing them into "not available" would leave a specialist
 * clicking the plate of a lot that has none and learning nothing.
 */
export function tabsFor(
  selection: PanelSelection | null,
  hasPhotograph: boolean,
): TabState[] {
  const target = polishTargetOf(selection);
  const reason = !selection
    ? "Select a part of a lot."
    : !target
      ? "Polish is for a photograph. This is the lot's " + selection.field + "."
      : !hasPhotograph
        ? "This lot has no photograph yet, so there is nothing to polish."
        : undefined;
  return [
    { id: "settings", label: "Settings", enabled: selection !== null,
      ...(selection ? {} : { reason: "Select a part of a lot." }) },
    { id: "polish", label: "Polish", enabled: reason === undefined,
      ...(reason === undefined ? {} : { reason }) },
  ];
}

// ── The gestures ────────────────────────────────────────────────────────────

/**
 * What a ground starts at when a specialist first chooses one.
 *
 * MID NEUTRAL, and a keyline gets the middle of its own width range. A default
 * is a DEFAULT AND NOT A LOCK (principle 9): it has to be visible and
 * adjustable the moment it appears, which is why the level and the tint
 * controls are shown as soon as a ground is picked rather than behind a
 * disclosure. Mid rather than light because a ground nobody can see is a
 * control that looks broken on first press.
 */
export function defaultGroundSpec(ground: Ground): GroundSpec | null {
  if (!groundTakesTone(ground)) return null;
  const base: GroundSpec = { level: "mid", tint: "neutral" };
  if (!groundTakesWidth(ground)) return base;
  return { ...base, widthMm: Math.round(((KEYLINE_MIN_MM + KEYLINE_MAX_MM) / 2) * 100) / 100 };
}

/**
 * Choose, change or clear the ground.
 *
 * THE SPEC TRAVELS WITH IT, in both directions, because a ground's parameters
 * cannot outlive its ground and this is the surface that can break that. The
 * storage layer enforces it too (`groundSpecFromValue` refuses a spec whose
 * ground does not take one), and both are wanted: the row can be trusted
 * whatever writes it, and the panel does not send a patch the row will
 * silently drop — which would leave the control showing a tint the page has
 * not got.
 *
 * A ground CHANGED rather than chosen keeps the level and the tint the
 * specialist already set, where the new ground takes them. Moving from a tone
 * to a sweep is a change of what the ground IS, not a decision to start again
 * at mid neutral.
 */
export function groundPatch(
  current: OverrideValue,
  ground: Ground | null,
): OverridePatch {
  if (ground === null) return { ground: null, groundSpec: null };
  const kept = current.groundSpec;
  const fresh = defaultGroundSpec(ground);
  if (!fresh) return { ground, groundSpec: null };
  const spec: GroundSpec = {
    level: kept?.level ?? fresh.level,
    tint: kept?.tint ?? fresh.tint,
    ...(groundTakesWidth(ground)
      ? { widthMm: kept?.widthMm ?? fresh.widthMm ?? KEYLINE_MIN_MM }
      : {}),
  };
  return { ground, groundSpec: spec };
}

/**
 * One parameter of the ground in force. Null ground, null patch — no row.
 *
 * ── THE GROUND TRAVELS WITH THE SPEC, AND IT IS NOT A COURTESY ──────────────
 *
 * `plateFromValue` validates a spec AGAINST the ground in the same record —
 * `groundSpecFromValue(record.groundSpec, out.ground)` — because a level and a
 * tint mean nothing without something to apply them to, and a width means
 * nothing except on a keyline. A patch carrying the spec alone therefore has no
 * ground to be checked against, is refused whole, and reaches the specialist as
 * "there was nothing in that change to save" with the control they just pressed
 * lit and the page unchanged.
 *
 * That is precisely what happened: choosing a ground and then its tone lost the
 * tone every time, and the sibling above already documented the rule this broke
 * — "the spec travels with it, in both directions". Found by a driven test
 * reading the painted grey off the page; every unit test in this file passed
 * throughout, because the patch it returned was well-formed and the thing that
 * refused it was three modules away.
 */
export function groundSpecPatch(
  current: OverrideValue,
  change: Partial<GroundSpec>,
): OverridePatch {
  const ground = current.ground;
  if (!ground || !groundTakesTone(ground)) return {};
  const base = current.groundSpec ?? defaultGroundSpec(ground);
  if (!base) return {};
  const widthMm = change.widthMm ?? base.widthMm;
  return {
    ground,
    groundSpec: {
      level: change.level ?? base.level,
      tint: change.tint ?? base.tint,
      ...(groundTakesWidth(ground) && widthMm !== undefined
        ? { widthMm: Math.min(KEYLINE_MAX_MM, Math.max(KEYLINE_MIN_MM, widthMm)) }
        : {}),
    },
  };
}

/**
 * 去背, as the quick action states it.
 *
 * A TOGGLE BETWEEN "CUT OUT" AND "NOBODY HAS SAID", not between the two values
 * of the vocabulary. `original` means a specialist looked at this plate and
 * decided it stays as supplied, which is a different statement from silence and
 * is worth a row of its own — but it is a statement you make in the tab, with
 * the three states in front of you, and not one you make by pressing a button
 * twice.
 */
export function cutoutTogglePatch(current: OverrideValue): OverridePatch {
  return { picture: current.picture === "cutout" ? null : "cutout" };
}

/** The three states, as the tab offers them. `null` is "nobody has said". */
export function picturePatch(value: PictureTreatment | null): OverridePatch {
  return { picture: value };
}

/**
 * The angle, from the two surfaces that set it.
 *
 * ONE FUNCTION FOR THE NUDGE AND THE TYPED VALUE, because a control whose −
 * button and whose typed entry landed on different hundredths is a readout
 * nobody can trust. Both go through the vocabulary's own clamp, so the panel
 * cannot send a value the row would bound on arrival — the specialist sees
 * the number that will be stored, which is the whole of principle 9's
 * "adjustable in the units the machine produced it in".
 */
export function straightenPatch(deg: number | null): OverridePatch {
  if (deg === null) return { straightenDeg: null };
  const bounded = Math.min(STRAIGHTEN_MAX_DEG, Math.max(-STRAIGHTEN_MAX_DEG, deg));
  const rounded = Math.round(bounded * 100) / 100;
  return { straightenDeg: rounded === 0 ? null : rounded };
}

/** One step of the ladder, finer with the modifier held. */
export function straightenNudgePatch(
  current: OverrideValue,
  direction: 1 | -1,
  fine: boolean,
): OverridePatch {
  const next = nudgeStraightenDeg(
    current.straightenDeg,
    direction,
    fine ? STRAIGHTEN_FINE_DEG : STRAIGHTEN_STEP_DEG,
  );
  return { straightenDeg: next };
}

/**
 * How many passages.
 *
 * ONE IS A VALUE AND NOT A CLEAR. "Show this work whole across the plate" is a
 * decision a specialist makes about a handscroll the engine offered to cut, and
 * dropping it would re-offer the cut on every visit. Clearing is a separate
 * gesture and sends null.
 */
export function bandsPatch(count: number | null): OverridePatch {
  if (count === null) return { bands: null };
  if (!Number.isInteger(count)) return {};
  return { bands: Math.min(MAX_BANDS, Math.max(1, count)) };
}

/** One axis of the colour correction. `null` returns that axis to neutral. */
export function gradePatch(
  current: OverrideValue,
  key: GradeKey,
  value: number | null,
): OverridePatch {
  return { grade: withGradeAxis(current.grade, key, value) };
}

/** 原色 — every axis back to neutral, and nothing else on the row touched. */
export function clearGradePatch(): OverridePatch {
  return { grade: null };
}

/**
 * 原狀 — every treatment off this plate, and nothing else on the row touched.
 *
 * NOT `clearOverride`, which removes the whole row. The row may also hold a
 * frame somebody dragged and a correction somebody typed, and "put this
 * photograph back as it was" does not mean "and move it back into the grid and
 * restore the typo". Six explicit nulls, listed rather than derived from the
 * patch type, for the same reason `PATCH_KEYS` is a list: a key nobody
 * declared must not reach a computed assignment.
 */
export function clearPolishPatch(): OverridePatch {
  return {
    picture: null,
    ground: null,
    groundSpec: null,
    bands: null,
    straightenDeg: null,
    grade: null,
  };
}

/** Has this plate been treated at all — i.e. is there anything to put back? */
export function isPolished(current: OverrideValue): boolean {
  return (
    current.picture !== undefined ||
    current.ground !== undefined ||
    current.bands !== undefined ||
    current.straightenDeg !== undefined ||
    current.grade !== undefined ||
    current.content !== undefined
  );
}

/**
 * A patch as it arrives from a browser — rebuilt, never spread.
 *
 * ── AN ARGUMENT IS A PROMISE ABOUT THE CALLER, NOT ABOUT THE POST ───────────
 *
 * A server function is reachable by direct POST and not only through the
 * panel, so what arrives here is `unknown` whatever its type says.
 * `placePartAction` already states the rule for a frame — rebuild through the
 * engine's own reader, so that a `hidden` riding in on the back of a drag never
 * reaches the patch — and this is the same rule for six more keys. Without it a
 * request that looked like a ground change could hide a lot's title.
 *
 * ── PRESENT-AND-NULL, PRESENT-AND-JUNK, AND ABSENT ARE THREE THINGS ─────────
 *
 * Which is the whole reason this cannot just call `plateFromValue` and hand the
 * answer over: that reader drops nulls, because a STORED value has no such
 * thing as a "clear". A patch does, and the three states must survive the trip
 * — an absent key leaves the row alone, an explicit null clears exactly that
 * key, and a value the vocabulary refuses is DROPPED rather than treated as a
 * clear. The last one matters: a malformed angle arriving as "erase the
 * specialist's straighten" would be a correction destroyed by a bug in the
 * sender.
 *
 * `groundSpec` is validated against the `ground` IN THE SAME PATCH, which is
 * what running the whole record through one reader buys: the invariant that a
 * ground's parameters cannot outlive its ground is checked here on the pair
 * that will be written, not on the pair that happens to be stored.
 */
export function platePatchFromValue(value: unknown): OverridePatch {
  if (typeof value !== "object" || value === null) return {};
  const record = value as Record<string, unknown>;
  const valid = plateFromValue(record) ?? {};
  const out: OverridePatch = {};
  // Spelled out per key rather than looped over a list of names. The loop is
  // shorter and it is the version that cannot be type-checked: each key has its
  // own value type, and the assignment that makes a loop compile is the cast
  // this function exists to avoid.
  if ("picture" in record) {
    if (record.picture === null) out.picture = null;
    else if (valid.picture !== undefined) out.picture = valid.picture;
  }
  if ("ground" in record) {
    if (record.ground === null) out.ground = null;
    else if (valid.ground !== undefined) out.ground = valid.ground;
  }
  if ("groundSpec" in record) {
    if (record.groundSpec === null) out.groundSpec = null;
    else if (valid.groundSpec !== undefined) out.groundSpec = valid.groundSpec;
  }
  if ("bands" in record) {
    if (record.bands === null) out.bands = null;
    else if (valid.bands !== undefined) out.bands = valid.bands;
  }
  if ("straightenDeg" in record) {
    if (record.straightenDeg === null) out.straightenDeg = null;
    else if (valid.straightenDeg !== undefined) out.straightenDeg = valid.straightenDeg;
  }
  if ("content" in record) {
    if (record.content === null) out.content = null;
    else if (valid.content !== undefined) out.content = valid.content;
  }
  if ("grade" in record) {
    if (record.grade === null) out.grade = null;
    else if (valid.grade !== undefined) out.grade = valid.grade;
  }
  return out;
}

/** Does this patch ask for anything? An empty one is a write nobody meant. */
export function patchIsEmpty(patch: OverridePatch): boolean {
  return Object.keys(patch).length === 0;
}

/**
 * The one combination the page cannot honour, said out loud, or null.
 *
 * A PASSAGE IS A WINDOW ONTO A BACKGROUND and CSS cannot turn a background
 * (src/lib/render/plate-css.ts says why the alternative is worse), so a plate
 * that is both cut into passages and straightened is painted cut and not
 * turned. Both values stay in the row — they are two decisions and neither
 * cancels the other — which means the page and the panel would silently
 * disagree unless somebody says so. This is somebody saying so.
 *
 * Returned rather than enforced: a control that deleted one of two stored
 * judgements to resolve a conflict is exactly the "lock, not a default" this
 * vocabulary is written against.
 */
export function conflictOf(current: OverrideValue): string | null {
  const banded = current.bands !== undefined && current.bands > 1;
  if (!banded || current.straightenDeg === undefined) return null;
  return "分段的作品以背景繪製，無法同時拉直；此頁按段數呈現，拉直角度已儲存但未套用。";
}

// ── What the control reads out ──────────────────────────────────────────────

/** The ground's own name, in the language the catalogue is set in. */
export const GROUND_LABELS: Readonly<Record<Ground, string>> = {
  sweep: "背景紙",
  tone: "底色",
  mount: "裱框",
  keyline: "細框線",
};

export const LEVEL_LABELS: Readonly<Record<GroundLevel, string>> = {
  light: "淺",
  mid: "中",
  dim: "深",
};

export const TINT_LABELS: Readonly<Record<GroundTint, string>> = {
  neutral: "中性",
  warm: "暖",
  cool: "冷",
};

export const PICTURE_LABELS: Readonly<Record<PictureTreatment, string>> = {
  original: "原圖",
  cutout: "去背",
};

/** The ladders a control walks, exported so the component lists nothing. */
export const GROUND_LEVEL_CHOICES = GROUND_LEVELS;
export const GROUND_TINT_CHOICES = GROUND_TINTS;

/**
 * The subject box as a person reads it — a percentage of the file per side, or
 * the sentence for a plate nobody has measured.
 *
 * IT SAYS WHERE THE VALUE CAME FROM, because that is the part a specialist
 * cannot see: nothing in this system measures a subject box (see
 * src/lib/render/plate-css.ts's header), so a box that is there was drawn by a
 * person and a plate with none is not "unmeasured yet, check back" — it is the
 * whole picture, now and until somebody says otherwise.
 */
export function contentReadout(current: OverrideValue): string {
  const c = current.content;
  if (!c) return "整張照片（無人另框主體）";
  const pc = (v: number): string => `${(v * 100).toFixed(1)}%`;
  return `主體框 ${pc(c.x)}, ${pc(c.y)} — ${pc(c.w)} × ${pc(c.h)}`;
}
