"use client";

import { useState, useTransition } from "react";

import { PrintFidelity } from "@/components/print-fidelity";
import { mergeOverride, type OverridePatch, type OverrideValue } from "@/lib/data/override-value";
import {
  GRADE_AXES,
  GRADE_KEYS,
  GRADE_LABELS,
  GROUNDS,
  KEYLINE_MAX_MM,
  KEYLINE_MIN_MM,
  MAX_BANDS,
  PICTURE_TREATMENTS,
  formatGradeValue,
  formatStraightenDeg,
  gradeValue,
  groundTakesWidth,
  type GradeKey,
  type Ground,
  type GroundLevel,
  type GroundTint,
  type PictureTreatment,
} from "@/lib/engine/plate";
import type { PlaceResult } from "@/lib/forms";
import {
  GROUND_LABELS,
  GROUND_LEVEL_CHOICES,
  GROUND_TINT_CHOICES,
  LEVEL_LABELS,
  PICTURE_LABELS,
  TINT_LABELS,
  bandsPatch,
  clearGradePatch,
  clearPolishPatch,
  conflictOf,
  contentReadout,
  cutoutTogglePatch,
  gradePatch,
  groundPatch,
  groundSpecPatch,
  isPolished,
  picturePatch,
  straightenNudgePatch,
  straightenPatch,
  tabsFor,
  type PanelSelection,
  type PolishTab,
} from "@/lib/polish/panel-model";
import { plateNotice, plateNoticeText, type PlateMeasurement } from "@/lib/polish/plate-note";
import { logAction } from "@/lib/log/client";

/**
 * The per-selection panel: what this catalogue says about the selected part.
 *
 * ── IT OWNS NO DATA AND NO ROUTE ────────────────────────────────────────────
 *
 * Everything it shows arrives as a prop and every change leaves through
 * `commit`. That is not ceremony — the editor's chrome belongs to another
 * agent this cycle, so this had to be mountable without reaching into
 * catalogue-workspace.tsx, and the interface it needed to keep clean is the
 * one a component like this usually ruins: it does not fetch, it does not know
 * the route, and it does not know which catalogue row it is writing. See the
 * mount note at the foot of this file.
 *
 * ── SETTINGS IS A SLOT AND POLISH IS OURS ───────────────────────────────────
 *
 * The two tabs answer two different questions about one selection: what this
 * catalogue SAYS about the part (hide it, print something else) and how the
 * PLATE is treated. The first already has controls elsewhere and this panel
 * does not duplicate them — a second copy of the hide checkbox is a second
 * place for it to disagree with the row — so Settings takes whatever its owner
 * puts in it.
 *
 * ── AND THE POLISH TAB IS DISABLED, NEVER HIDDEN ────────────────────────────
 *
 * On a caption row it is greyed with a sentence saying polish is for a
 * photograph. A control that vanishes teaches nobody what it was for, and a
 * specialist who saw two tabs on a plate and one on a title would learn that
 * the product is inconsistent rather than that a title has no ground.
 *
 * ── NOTHING DISABLES ITSELF WHILE SAVING ────────────────────────────────────
 *
 * The predecessor's most embarrassing defect: a field that set `disabled` on
 * submit is BLURRED BY THE BROWSER, so it eats its own keystrokes and typing
 * −1.37 arrives as nothing. Every control here stays live; the only thing a
 * pending write changes is a word beside the heading.
 */

export interface PolishPanelProps {
  /** For the action's own guards; this component never builds a URL. */
  eventId: string;
  /** For the action log, which is the instrument principle 3 is decided by. */
  catalogueId: string | null;
  selection: PanelSelection | null;
  /** What this catalogue already says about the selected lot's PLATE. */
  value: OverrideValue;
  /** Whether the selected lot has a photograph at all. */
  hasPhotograph: boolean;
  /** `assets.geometry` for that photograph, or null when it was unmeasurable. */
  measured?: PlateMeasurement | null;
  /** The writer. Bound by whoever mounts this; see the foot of the file. */
  commit: (patch: OverridePatch) => Promise<PlaceResult>;
  /** The Settings tab's contents, owned by the mounting screen. */
  settings?: React.ReactNode;
}

/**
 * What each treatment does to the plate, on the control itself.
 *
 * The one distinction a specialist must not get wrong is 去背's: it takes the
 * PLATE's grey field off, and it cannot take the photograph's own background
 * out, because nothing in this system produces a cut-out derivative. That used
 * to be a paragraph under the row; it is here now, where it arrives at the
 * moment somebody wonders and takes none of the panel.
 */
const PICTURE_NOTE: Readonly<Record<PictureTreatment, string>> = {
  original: "The photograph as supplied, on the plate's own field.",
  cutout:
    "Takes the grey field off the plate so the object sits on the paper. The photograph's own background is unchanged.",
};

/** Every pressable thing in this panel stands on the house floor. */
const TAP = "min-h-[var(--tap)]";
const BUTTON = `${TAP} border border-rule bg-paper px-2 text-[12px] text-ink hover:bg-sunk`;
const PICKED = `${TAP} border border-ink bg-sunk px-2 text-[12px] font-medium text-ink`;

export function PolishPanel({
  eventId: _eventId,
  catalogueId,
  selection,
  value: stored,
  hasPhotograph,
  measured = null,
  commit,
  settings,
}: PolishPanelProps): React.ReactElement {
  const [tab, setTab] = useState<PolishTab>("polish");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // THE ONE FIELD WITH A DRAFT. A number somebody is typing is not a value yet
  // — "-" and "1." are both on the way to −1.37 and neither is a legal angle —
  // so the text lives here until they finish. Everything else in this panel is
  // a press, where the gesture and the value are the same event.
  const [angle, setAngle] = useState<string | null>(null);

  // ── WHAT THIS PANEL BELIEVES THE ROW SAYS ─────────────────────────────────
  //
  // `stored` is the server's word as of the last render. Nothing here disables
  // while it writes — deliberately, see the note on the angle above — so two
  // presses in quick succession both build their patch from the value that was
  // on screen when the first one left.
  //
  // THAT IS NOT A COSMETIC RACE, BECAUSE THE PATCHES ARE MERGES.
  // `groundSpecPatch` reads the ground IN FORCE to decide whether there is a
  // spec to change at all, so against a value that has not caught up it returns
  // an empty patch and the action answers "there was nothing in that change to
  // save". Measured, by a driven test: choosing a ground and then its tone, at
  // the speed a hand does it, lost the tone every time — silently, with the
  // right control lit and the wrong grey on the page.
  //
  // So the panel keeps what it has written until the server's next word
  // arrives, and merges through `mergeOverride` — the writer's own merge, which
  // is why src/lib/data/override-value.ts exists. An optimistic view computed a
  // second way is a second answer to what the row says.
  // React's own "adjust state when a prop changes" shape — the previous value
  // kept in state and compared during render, not a ref read in render and not
  // an effect that would paint the stale value first.
  //
  // BY VALUE AND NOT BY IDENTITY, which is the whole of the difference. Every
  // render of the page makes a new `value` object, and a page can re-render for
  // reasons that have nothing to do with this panel — so identity says "the
  // server has spoken" on refreshes that carry the same row as before. The
  // driven pass caught it: press a ground, and the panel snapped back to
  // showing no ground while the PAGE behind it had already painted one. A
  // content comparison holds the optimistic view until the row genuinely
  // changes, which is the only event it was ever meant to yield to.
  const [written, setWritten] = useState<OverrideValue | null>(null);
  const storedKey = JSON.stringify(stored);
  const [seenKey, setSeenKey] = useState(storedKey);
  if (seenKey !== storedKey) {
    // THE SERVER'S WORD WINS, ALWAYS, and a refusal reaches here as a value
    // that does not carry the patch — which is exactly right, because a
    // refused patch did not happen.
    setSeenKey(storedKey);
    setWritten(null);
  }
  const value = written ?? stored;

  const tabs = tabsFor(selection, hasPhotograph);
  const polish = tabs.find((t) => t.id === "polish")!;
  const active = tabs.find((t) => t.id === tab)?.enabled ? tab : "settings";

  const send = (what: string, patch: OverridePatch): void => {
    logAction(`catalogue.polish.${what}`, { lotId: selection?.lotId ?? null }, catalogueId);
    setWritten(mergeOverride(value, patch) ?? {});
    startTransition(async () => {
      const result = await commit(patch);
      setMessage(result.ok ? null : result.message);
      // A REFUSAL PUTS THE SCREEN BACK. The row did not change, so neither may
      // the panel — showing a treatment the catalogue has not got is worse than
      // showing none, because the next patch would be built on it.
      if (!result.ok) setWritten(null);
    });
  };

  const notice = plateNotice(measured, value.content);

  return (
    <section className="flex flex-col gap-2 border-t border-rule bg-paper p-2">
      <div role="tablist" aria-label="Selected part" className="flex gap-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={active === t.id}
            // DISABLED AND STILL IN THE TAB ORDER'S PLACE, with the reason on
            // the element itself: a screen reader reads `aria-disabled` and
            // the title, where `disabled` would have removed the control and
            // the explanation with it.
            aria-disabled={!t.enabled}
            title={t.reason ?? undefined}
            onClick={() => t.enabled && setTab(t.id)}
            className={`${active === t.id ? PICKED : BUTTON} ${
              t.enabled ? "" : "cursor-not-allowed text-faint"
            }`}
          >
            {t.label}
          </button>
        ))}
        {pending && <span className="self-center text-[10px] text-faint">saving…</span>}
      </div>

      {message && (
        <p role="alert" className="border-l-2 border-seal bg-sealSoft px-2 py-1 text-[12px] text-ink">
          {message}
        </p>
      )}

      {active === "settings" && (
        <div className="text-[12px] text-muted">
          {settings ?? "What this catalogue says about the selected part."}
        </div>
      )}

      {active === "polish" && !polish.enabled && (
        <p className="text-[12px] text-faint">{polish.reason}</p>
      )}

      {active === "polish" && polish.enabled && (
        <div className="flex flex-col gap-3">
          {/* ── The quick actions ────────────────────────────────────────────
              去背 and 拉直, because those are the two a specialist reaches for
              without thinking — one is a yes/no about the photograph and the
              other is a nudge they will make four times in a row. Everything
              else needs a decision and therefore a row of its own below. */}
          <div className="flex flex-wrap items-center gap-1">
            <button
              type="button"
              className={value.picture === "cutout" ? PICKED : BUTTON}
              onClick={() => send("cutout", cutoutTogglePatch(value))}
            >
              去背
            </button>
            <button
              type="button"
              title="Turn the picture anticlockwise. Hold Shift for a hundredth of a degree."
              className={BUTTON}
              onClick={(e) => send("straighten", straightenNudgePatch(value, -1, e.shiftKey))}
            >
              ⟲
            </button>
            <span className="min-w-[4.5em] text-center text-[12px] tabular-nums text-muted">
              {formatStraightenDeg(value.straightenDeg)}°
            </span>
            <button
              type="button"
              title="Turn the picture clockwise. Hold Shift for a hundredth of a degree."
              className={BUTTON}
              onClick={(e) => send("straighten", straightenNudgePatch(value, 1, e.shiftKey))}
            >
              ⟳
            </button>
            {isPolished(value) && (
              <button
                type="button"
                title="Every treatment off this plate. A frame or a text correction on the same row is kept."
                className={`${BUTTON} ml-auto`}
                onClick={() => send("clear", clearPolishPatch())}
              >
                原狀
              </button>
            )}
          </div>

          {/* WHAT THE PAGE IS OBEYING when two stored decisions cannot both be
              painted. Neither is deleted to resolve it — that would be a
              control taking a judgement away — so the disagreement is stated
              instead of being left for somebody to find on a proof. */}
          {conflictOf(value) && (
            <p className="border-l-2 border-seal bg-sealSoft px-2 py-1 text-[12px] text-ink">
              {conflictOf(value)}
            </p>
          )}

          {notice && (
            <p className="border-l-2 border-seal bg-sealSoft px-2 py-1 text-[12px] text-ink">
              {plateNoticeText(notice, value.bands)}
              {value.bands === undefined && (
                <button
                  type="button"
                  className={`${BUTTON} ml-2`}
                  onClick={() => send("bands", bandsPatch(notice.passages))}
                >
                  分 {notice.passages} 段
                </button>
              )}
            </p>
          )}

          <Row label="照片">
            {PICTURE_TREATMENTS.map((p: PictureTreatment) => (
              <button
                key={p}
                type="button"
                className={value.picture === p ? PICKED : BUTTON}
                title={PICTURE_NOTE[p]}
                onClick={() => send("picture", picturePatch(value.picture === p ? null : p))}
              >
                {PICTURE_LABELS[p]}
              </button>
            ))}
            {/* ── THE PARAGRAPH WENT AND THE PROMISE MOVED INTO THE LABEL ──
                A sentence stood here explaining that 去背 takes the plate's
                grey field off and does NOT cut the photograph's own background
                out. The distinction is real and a specialist has to have it —
                a control whose name promises more than its renderer delivers
                is the defect this vocabulary keeps paying for — but a
                paragraph of explanation under a row of buttons is the product
                narrating itself, which the owner's rule refuses.

                So it is in the button's own title, where it arrives at the
                moment somebody wonders, and the result is one press away on
                the plate itself. */}
          </Row>

          <Row label="底">
            {GROUNDS.map((g: Ground) => (
              <button
                key={g}
                type="button"
                className={value.ground === g ? PICKED : BUTTON}
                onClick={() => send("ground", groundPatch(value, value.ground === g ? null : g))}
              >
                {GROUND_LABELS[g]}
              </button>
            ))}
          </Row>

          {value.ground && (
            <Row label="色調">
              {GROUND_LEVEL_CHOICES.map((level: GroundLevel) => (
                <button
                  key={level}
                  type="button"
                  className={value.groundSpec?.level === level ? PICKED : BUTTON}
                  onClick={() => send("groundLevel", groundSpecPatch(value, { level }))}
                >
                  {LEVEL_LABELS[level]}
                </button>
              ))}
              {GROUND_TINT_CHOICES.map((tint: GroundTint) => (
                <button
                  key={tint}
                  type="button"
                  className={value.groundSpec?.tint === tint ? PICKED : BUTTON}
                  onClick={() => send("groundTint", groundSpecPatch(value, { tint }))}
                >
                  {TINT_LABELS[tint]}
                </button>
              ))}
            </Row>
          )}

          {groundTakesWidth(value.ground) && (
            <Row label="線寬">
              <input
                type="number"
                step={0.05}
                min={KEYLINE_MIN_MM}
                max={KEYLINE_MAX_MM}
                defaultValue={value.groundSpec?.widthMm ?? KEYLINE_MIN_MM}
                aria-label="Keyline width in millimetres"
                className={`${TAP} w-24 border border-rule bg-field px-2 text-[13px] tabular-nums`}
                onBlur={(e) =>
                  send("keyline", groundSpecPatch(value, { widthMm: Number(e.target.value) }))
                }
              />
              <span className="text-[10px] text-faint">mm</span>
            </Row>
          )}

          <Row label="拉直">
            <input
              type="text"
              inputMode="decimal"
              // NOT `type=number`: a partially typed "-" is not a number and
              // the browser hands back "", so the minus a specialist typed is
              // lost before they can type the digits after it.
              value={angle ?? (value.straightenDeg ?? 0).toFixed(2)}
              aria-label="Straighten, in degrees"
              className={`${TAP} w-24 border border-rule bg-field px-2 text-[13px] tabular-nums`}
              onChange={(e) => setAngle(e.target.value)}
              onBlur={() => {
                const typed = Number(angle);
                setAngle(null);
                if (angle !== null && angle.trim() !== "" && Number.isFinite(typed)) {
                  send("straighten", straightenPatch(typed));
                }
              }}
            />
            <span className="text-[10px] text-faint">°, ±15</span>
          </Row>

          <Row label="段數">
            <input
              type="number"
              step={1}
              min={1}
              max={MAX_BANDS}
              defaultValue={value.bands ?? 1}
              aria-label="Passages this work is cut into"
              className={`${TAP} w-24 border border-rule bg-field px-2 text-[13px] tabular-nums`}
              onBlur={(e) => send("bands", bandsPatch(Math.round(Number(e.target.value))))}
            />
            {value.bands !== undefined && (
              <button type="button" className={BUTTON} onClick={() => send("bands", bandsPatch(null))}>
                取消
              </button>
            )}
          </Row>

          {/* ── 調色 ───────────────────────────────────────────────────────────
              Five numbers in one row, on one ladder. A range input rather than
              a text box because the gesture is a comparison — a specialist
              moves it and watches the plate — and the number is printed beside
              it because the value is what they have to be able to reproduce. */}
          <div className="flex flex-col gap-1">
            <div className="flex items-baseline gap-2">
              <span className="text-[10px] uppercase tracking-wider text-faint">調色</span>
              {value.grade && (
                <button
                  type="button"
                  className={`${BUTTON} ml-auto`}
                  onClick={() => send("gradeClear", clearGradePatch())}
                >
                  原色
                </button>
              )}
            </div>
            {GRADE_KEYS.map((key: GradeKey) => (
              <label key={key} className={`${TAP} flex items-center gap-2`}>
                <span className="w-16 shrink-0 text-[12px] text-muted">{GRADE_LABELS[key]}</span>
                <input
                  type="range"
                  min={GRADE_AXES[key].min}
                  max={GRADE_AXES[key].max}
                  step={1}
                  value={gradeValue(value.grade, key)}
                  className={`${TAP} flex-1 accent-seal`}
                  onChange={(e) => send(`grade.${key}`, gradePatch(value, key, Number(e.target.value)))}
                />
                <span className="w-12 shrink-0 text-right text-[12px] tabular-nums text-muted">
                  {formatGradeValue(key, gradeValue(value.grade, key))}
                </span>
              </label>
            ))}
          </div>

          {/* THE SUBJECT BOX IS READ, NOT SET, HERE — and the readout says so.
              Drawing one is a gesture on the preview, which belongs to the
              overlay; what this panel owes a specialist is the ability to see
              that there is one and to take it off again. */}
          <Row label="主體">
            <span className="text-[12px] tabular-nums text-muted">{contentReadout(value)}</span>
            {value.content && (
              <button
                type="button"
                className={BUTTON}
                onClick={() => send("content", { content: null })}
              >
                取消
              </button>
            )}
          </Row>

          <PrintFidelity />
        </div>
      )}
    </section>
  );
}

/** One labelled row of controls. The label is 10px small caps, as the house's
 *  other panels set a field name (see pin-panel.tsx). */
function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="w-10 shrink-0 text-[10px] uppercase tracking-wider text-faint">{label}</span>
      {children}
    </div>
  );
}

// ── HOW THIS MOUNTS ─────────────────────────────────────────────────────────
//
// It is a leaf. The editor's screen — src/app/events/[id]/catalogue/page.tsx,
// which reads the sale on the server — already loads the catalogue, the lots
// and `listOverrides`, and already renders `CatalogueWorkspace`. The panel goes
// into that workspace's `panel` slot, or beside it, with five props:
//
//   selection      the editor's current `PreviewSelection`, which
//                  catalogue-workspace.tsx holds and passes to the overlay
//                  today. `{ lotId, field }` is all this needs; the structural
//                  type means no import from the editor's modules.
//
//   value          `listOverridesForLot(org, catalogue, lotId)` filtered to the
//                  row whose `field` is "images", or `{}` when there is none.
//
//   hasPhotograph  whether that lot has one — the workspace already knows, from
//                  the same `listLotsWithImages` it derives the document from.
//
//   measured       `assets.geometry` for the lot's primary photograph, as
//                  `{ width, height }`, or null. Only the plate note reads it,
//                  and the note is simply absent without it.
//
//   commit         `(patch) => polishPlateAction(eventId, lotId, patch)`, from
//                  src/lib/polish/actions.ts. Bound at the mount site rather
//                  than imported here, because a client component that imported
//                  the action directly would fix which route it writes through
//                  — and the lot page is the second surface that will want this
//                  panel.
//
// Nothing else changes. The panel re-reads its props after each commit because
// the action revalidates the catalogue path, so there is no client cache here
// and no second reader of the overrides table.
