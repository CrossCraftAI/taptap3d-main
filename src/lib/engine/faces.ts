// The typeface a catalogue is set in.
//
// ── ONE HARDCODED STACK SERVED EVERY HOUSE UNTIL NOW ────────────────────────
//
// src/lib/render/html.ts named six families in a literal and every catalogue of
// every house got them. For a Traditional Chinese product the type colour of a
// page is most of what a house is buying, so that is a decision the product was
// making on the customer's behalf and never letting them take.
//
// ── WHY THERE ARE EXACTLY TWO, AND IT IS NOT A PRODUCT OPINION ──────────────
//
// The PDF is rendered by the SERVER, so a face a house can choose has to be a
// face the image actually holds. `fc-list` on the deployed container reports
// two Traditional Chinese families and no others:
//
//   Noto Serif CJK HK / TC      from Alpine's font-noto-cjk-extra
//   Noto Sans  CJK HK / TC      from font-noto-cjk
//
// So "Songti TC" or "Source Han Serif TC" as a third choice would resolve to
// Noto Serif on the server and print identically to 明體 — a control that does
// nothing, which is the one thing a control must never be. They stay in the
// serif STACK as rungs for a specialist's own machine, where they do exist and
// do differ; they are not offered as choices.
//
// Adding a third face is adding a font to the Dockerfile and an entry here, in
// that order. The order matters: an entry without the font is a promise the
// printer breaks.
//
// ── HK BEFORE TC, IN BOTH ───────────────────────────────────────────────────
//
// Noto ships separate HK and TC faces because Hong Kong and Taiwan standardise
// different glyph forms for the same characters, and the first customers are
// Hong Kong houses printing Hong Kong catalogues. Naming HK first is the
// difference between a catalogue that looks locally typeset and one that looks
// imported.

/** The faces the fidelity probes ask a machine about, across every face. */
export const CJK_FACES = [
  "Noto Serif CJK HK",
  "Noto Serif CJK TC",
  "Noto Serif TC",
  "Source Han Serif TC",
  "Songti TC",
  "Noto Sans CJK HK",
  "Noto Sans CJK TC",
  "Noto Sans TC",
  "PingFang TC",
  "Microsoft JhengHei",
] as const;

export interface Face {
  /**
   * A string and not a union, for `CatalogueParams.template`'s reason: a face
   * added later needs no change at the type level.
   */
  id: string;
  /** Bilingual, because the first customers work in Traditional Chinese. */
  name: { zh: string; en: string };
  /** One line for the person choosing: what this face is FOR. */
  purpose: string;
  /**
   * The CSS `font-family` value, VERBATIM AND PREFORMATTED — line breaks and
   * indentation included.
   *
   * ── WHY A FORMATTED STRING AND NOT A LIST TO JOIN ─────────────────────────
   *
   * 明體's value is byte-for-byte what `html.ts` emitted before this file
   * existed, wrapping and all. That is not tidiness: the four goldens in
   * test/golden are the printed page frozen, and reflowing this declaration
   * onto one line would move all four while changing nothing a printer could
   * see. A golden that moves for a reason nobody can see is a golden people
   * learn to regenerate without reading.
   *
   * So the default's bytes are preserved by construction, and every catalogue
   * printed before today still renders identically. 黑體 is authored to the
   * same wrapping so the two read alike in the stylesheet.
   */
  stack: string;
  /**
   * The CSS comment that stands above the declaration, preformatted the same
   * way and for the same reason.
   *
   * ── WHY THE PROSE SHIPS, AND WHY IT IS PER FACE ───────────────────────────
   *
   * This stylesheet has always argued for itself in the document it produces,
   * and 明體's paragraph is byte-for-byte the one that shipped — so the four
   * goldens do not move. But it ARGUES THE SERIF'S STACK: it says the last
   * CJK rung is a sans on purpose. Emitted above a 黑體 declaration that would
   * be a sentence contradicting the line beneath it, which is worse than no
   * comment at all. So each face brings its own.
   */
  note: string;
  /**
   * The CJK rungs of `stack`, in order — what a machine is asked about.
   *
   * INCLUDING THE COMPROMISE RUNGS. A sans in a serif stack is the last thing
   * before tofu: a sans catalogue is a compromise and tofu is a reprint, so a
   * machine with only that one can READ the preview and is still not seeing
   * the page. `faithful` is what separates them.
   */
  cjk: readonly string[];
  /**
   * The faces that ARE this one. A machine holding any of these is looking at
   * the catalogue; a machine holding only the rest of `cjk` is not.
   */
  faithful: readonly string[];
}

const SERIF: Face = {
  id: "serif",
  name: { zh: "明體", en: "Serif" },
  purpose: "The printed sale catalogue. What a house sets an auction in.",
  // DO NOT REFLOW EITHER OF THESE. See `stack` and `note` above — every line
  // break below is a byte in four goldens.
  note: `/* HK BEFORE TC, AND THAT IS A DOMAIN DECISION RATHER THAN A PREFERENCE.
       Noto Serif CJK ships separate HK and TC faces because Hong Kong and
       Taiwan standardise different glyph forms for the same characters, and the
       first customers are Hong Kong houses printing Hong Kong catalogues. Both
       are in the image; naming HK first is the difference between a catalogue
       that looks locally typeset and one that looks imported.

       The container's faces come first, then a specialist's own machine, then
       Latin. "Noto Sans CJK HK" is the last CJK rung on purpose: a sans
       catalogue is a compromise, and tofu is a reprint. */`,
  stack: `"Noto Serif CJK HK", "Noto Serif CJK TC", "Noto Serif TC",
      "Source Han Serif TC", "Songti TC", "Noto Sans CJK HK", Georgia,
      "Times New Roman", serif`,
  cjk: [
    "Noto Serif CJK HK",
    "Noto Serif CJK TC",
    "Noto Serif TC",
    "Source Han Serif TC",
    "Songti TC",
    "Noto Sans CJK HK",
  ],
  faithful: [
    "Noto Serif CJK HK",
    "Noto Serif CJK TC",
    "Noto Serif TC",
    "Source Han Serif TC",
    "Songti TC",
  ],
};

const SANS: Face = {
  id: "sans",
  name: { zh: "黑體", en: "Sans" },
  purpose: "Contemporary and design sales, and a house with a sans identity.",
  note: `/* HK BEFORE TC, for the reason the serif face argues at length: Hong
       Kong and Taiwan standardise different glyph forms, and these catalogues
       are printed in Hong Kong.

       The container's faces come first, then a specialist's own machine —
       PingFang on a Mac, JhengHei on Windows, and both are the sans a reader
       there already knows. "Noto Serif CJK HK" is the last CJK rung on
       purpose, the mirror of the serif face's last rung: the wrong kind of
       face is a compromise, and tofu is a reprint. */`,
  // THE MIRROR OF THE ONE ABOVE, and the last CJK rung is a serif for the same
  // reason the serif's is a sans: wrong and readable beats tofu.
  stack: `"Noto Sans CJK HK", "Noto Sans CJK TC", "Noto Sans TC",
      "PingFang TC", "Microsoft JhengHei", "Noto Serif CJK HK",
      "Helvetica Neue", Arial, sans-serif`,
  cjk: [
    "Noto Sans CJK HK",
    "Noto Sans CJK TC",
    "Noto Sans TC",
    "PingFang TC",
    "Microsoft JhengHei",
    "Noto Serif CJK HK",
  ],
  faithful: [
    "Noto Sans CJK HK",
    "Noto Sans CJK TC",
    "Noto Sans TC",
    "PingFang TC",
    "Microsoft JhengHei",
  ],
};

export const FACES: readonly Face[] = [SERIF, SANS];

/**
 * The face every catalogue written before this key existed is set in, and the
 * one a new catalogue arrives on.
 */
export const DEFAULT_FACE = SERIF;

/**
 * Whatever `catalogues.params.face` holds, as a face.
 *
 * TOTAL, and it falls back rather than failing — `templateFor`'s rule, for
 * `templateFor`'s reason. The column is jsonb, every row written before today
 * has no `face` at all, and a catalogue whose face nobody recognises must
 * still print.
 */
export function faceFor(raw: unknown): Face {
  if (typeof raw !== "string") return DEFAULT_FACE;
  return FACES.find((face) => face.id === raw) ?? DEFAULT_FACE;
}
