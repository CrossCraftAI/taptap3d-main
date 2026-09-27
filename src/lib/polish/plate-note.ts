// What the ENGINE has a reservation about, on one plate.
//
// Ported in shape from the predecessor's src/lib/render/plate-fitness.ts and
// (editor)/…/plate-notes.ts, and it is deliberately the smaller half of them.
// The rule both files were written under is kept whole: a reservation is stated
// as a MEASUREMENT with the number in it, never as advice. A specialist can act
// on "28.7:1, one passage would print 7mm tall"; they cannot act on
// 「比例過寬」.
//
// ── WHY THE RESOLUTION HALF IS NOT HERE, AND EXACTLY WHAT IT WOULD NEED ─────
//
// The predecessor's other notice is the one with a press bill attached: ten of
// its forty-three demo plates were under 700px on their long side and were
// being asked to fill 174mm of paper, and nothing in the product said so. It
// is not ported, and this is the reason rather than an omission.
//
// It needs the plate's printed size IN MILLIMETRES. There, that was
// `pageSize × slotFrame × elFrame` — three numbers the layout tree carried,
// because the predecessor's engine placed every element itself. This engine
// does not: a plate's box is decided by CSS, from the template's margin and
// plate share TOGETHER WITH the grid's gap, the folio's height and the eight
// pixels between a plate and its caption — three numbers that live in
// src/lib/render/html.ts's stylesheet and nowhere else. Computing the
// millimetres here would mean copying them into the engine, where they would
// be a second copy of the layout, silently wrong the first time a rule in that
// stylesheet changed, and wrong in the direction that tells a specialist a
// plate is fine.
//
// ARCHITECTURE.md forbids the honest alternative outright — "the engine never
// reads rendered output" — so measuring the painted box is not available
// either. The way to earn this notice is for the RENDERER to publish the
// plate's box the way it already publishes a placed part's frame, and for the
// engine to read that back; that is a change to the print path and to the
// document's shape, and it did not belong in the same tranche as eight
// treatments.
//
// ── AND WHY THIS ONE IS WORTH HAVING ON ITS OWN ─────────────────────────────
//
// Because it is the producer 段數 has been waiting for. `bands` is "how many
// passages an ultra-wide work is cut into", and until now nothing in the system
// could tell a specialist that a work WAS ultra-wide — so the control existed
// for a condition nobody could see. This says the condition out loud and offers
// the count that answers it.

import { MAX_BANDS } from "@/lib/engine/plate";

/** What a photograph's bytes say it is. `assets.geometry`, structurally. */
export interface PlateMeasurement {
  width: number;
  height: number;
}

/**
 * The work's own proportions, corrected by a subject box where one exists.
 *
 * THE HUMAN'S BOX WINS, exactly as it does in the renderer: a specialist who
 * has stated a subject box has said which part of the file is the work, so a
 * verdict computed from the whole file would describe a plate that is not on
 * the page. With no box — which is every plate in this system until somebody
 * draws one — it is the file's own aspect, which is the honest fallback and
 * not a guess.
 *
 * ALWAYS ≥ 1, because "how far from square" is the question and a tall scroll
 * has the same problem as a wide one with the page turned.
 */
export function workAspect(
  measured: PlateMeasurement,
  content?: { w: number; h: number },
): number | null {
  const w = measured.width * (content?.w ?? 1);
  const h = measured.height * (content?.h ?? 1);
  if (!(w > 0) || !(h > 0)) return null;
  const ratio = w / h;
  return ratio >= 1 ? ratio : 1 / ratio;
}

/**
 * Past this, one passage cannot carry the work — 8:1.
 *
 * MEASURED AGAINST THE WIDEST PLATE THIS RENDERER CAN DRAW, which is a full
 * live width of A4 portrait: 210mm less the built-in templates' margin on both
 * sides is about 190mm. A work of aspect R printed to that width is 190/R
 * millimetres tall, so 8:1 is 23.75mm — about the point at which a painting's
 * brushwork stops being visible at reading distance, and the last ratio at
 * which "it will look small" is still true rather than "it is a coloured line".
 * Re-measure by dividing 190 by the ratio and holding a ruler to the page.
 *
 * IT IS A FLOOR AND NOT A THRESHOLD, and that asymmetry is deliberate. A plate
 * in a nine-up grid is a fraction of that width and reaches the same
 * illegibility at a far smaller ratio, so this notice is CONSERVATIVE: every
 * plate it flags is genuinely unprintable whole, and plates it stays quiet
 * about may still be too small. Being quiet is the right failure here — the
 * alternative is an amber mark on a page of perfectly good photography, which
 * is how a warning gets ignored.
 */
export const ULTRA_WIDE_ASPECT = 8;

export interface PlateNotice {
  /** The only kind this system can honestly derive. See the header. */
  kind: "ultra-wide";
  /** The work's proportions as a ratio ≥ 1 — 28.7 for a 28.7:1 handscroll. */
  aspect: number;
  /** The file's pixels, so "find a bigger file" is at least addressable. */
  pixels: PlateMeasurement;
  /**
   * How many passages would bring each one back under the ratio.
   *
   * A SUGGESTION AND NOT A SETTING. The count a plate is actually cut into is
   * the specialist's `bands`, and this is what the panel offers when they have
   * not said. Capped at MAX_BANDS, which a 100:1 scroll reaches — and a scroll
   * that needs more passages than the cap is a scroll this page cannot hold,
   * which the ratio in the sentence already says.
   */
  passages: number;
}

/**
 * One plate's reservation, or null when the engine has nothing to say.
 *
 * NULL FOR AN UNMEASURED PLATE, which is not silence by oversight: with no
 * `assets.geometry` there is no aspect to take, and inventing a warning out of
 * the absence of a measurement would mark every plate in a house that has not
 * backfilled. The predecessor made the same call for the same reason.
 */
export function plateNotice(
  measured: PlateMeasurement | null | undefined,
  content?: { w: number; h: number },
): PlateNotice | null {
  if (!measured) return null;
  const aspect = workAspect(measured, content);
  if (aspect === null || aspect < ULTRA_WIDE_ASPECT) return null;
  return {
    kind: "ultra-wide",
    aspect,
    pixels: { width: measured.width, height: measured.height },
    passages: Math.min(MAX_BANDS, Math.ceil(aspect / ULTRA_WIDE_ASPECT)),
  };
}

/**
 * The sentence beside the plate.
 *
 * SECOND PERSON AND AN ACTION, because the specialist reading it holds the only
 * lever that moves: cut the work into passages, or accept a hairline. A note
 * that only diagnoses is a note that gets dismissed. Traditional Chinese,
 * because the product is (DFD.md), with the two numbers in it that a person
 * can check against the file.
 *
 * WHAT IT SAYS DEPENDS ON WHAT THE PAGE IS DOING, not on what the engine would
 * prefer: a plate already cut into passages has been answered, and repeating
 * the offer would read as the product not noticing.
 */
export function plateNoticeText(notice: PlateNotice, bands?: number): string {
  const ratio = `${notice.aspect.toFixed(1)}:1`;
  const px = `${notice.pixels.width}×${notice.pixels.height} 像素`;
  if (bands !== undefined && bands > 1) {
    return `此作比例 ${ratio}（${px}），已分 ${bands} 段呈現。`;
  }
  if (bands === 1) {
    return `此作比例 ${ratio}（${px}），整幅橫貫版面，會印成一條窄帶。`;
  }
  return `此作比例 ${ratio}（${px}），整幅印出僅約一條窄帶；建議分 ${notice.passages} 段。`;
}
