// Whether the machine looking at the preview can actually SET the catalogue.
//
// ── THE DIVERGENCE NOBODY SEES UNTIL THE PROOF COMES BACK ───────────────────
//
// src/lib/render/html.ts asks for a Traditional Chinese serif and names six
// faces before falling to Georgia. NO WEBFONT IS LOADED ANYWHERE, so on a
// machine that has none of the six the preview is set in whatever the browser
// reaches for — on Windows that is usually Microsoft JhengHei, a SANS face —
// and the specialist judges a spread, approves it, and receives a proof set in
// a serif they have never seen. For a Traditional Chinese product that is not
// a styling nicety; the type colour of a page is most of what a house is
// buying.
//
// The PDF path has had an answer to this since it was written: it draws 青 and
// a private-use codepoint on a canvas and compares the pixels, and the result
// travels out on `x-taptap3d-cjk` (src/lib/render/pdf.ts). The PREVIEW had
// none, so the two outputs disagreed about whether anybody had been told.
//
// ── WHY THE ANSWER IS A CHECK AND NOT A WEBFONT ─────────────────────────────
//
// Loading one was the first choice and it is not available, for two reasons
// that are both structural rather than budgetary:
//
//   THE PREVIEW'S CSP FORBIDS IT. The document carries `default-src 'none'`
//   with `img-src` as the single relaxation, and no `font-src` — so an
//   `@font-face` pointing anywhere, including at a `data:` URI, is blocked.
//   Adding `font-src` would change `PREVIEW_CSP`, which is the first tag in
//   the head of every document this renderer has ever produced: all four
//   goldens move, every catalogue in production changes bytes, and the policy
//   that ARCHITECTURE.md principle 8 rests on is widened for a font. That is
//   the wrong trade by a wide margin.
//
//   AND IT WOULD NOT REACH THE PREVIEW ANYWAY. A font loaded by the
//   application shell is loaded into the PARENT document; the preview is a
//   separate document with its own policy and its own font resolution, and
//   nothing the parent loads is available inside it. So the obvious change —
//   `next/font` in src/app/layout.tsx — would dress the chrome and leave the
//   one document that matters exactly as it was.
//
// A third option, deleting the `--font-serif` token from src/app/globals.css,
// was proposed here on the belief that it was dead. IT IS NOT: the provenance
// box on the movement screen sets its lines in it, which is correct — that box
// quotes what the catalogue will print. What was actually wrong is that the
// token's stack and this document's did not agree, so the chrome and the
// preview could resolve to different faces on one machine. Reconciled in
// globals.css rather than deleted.
//
// So: the machine is asked, and what it answers is SHOWN. That is also the
// honest version of principle 10 — measure, don't assert — applied to the one
// claim this product cannot make on the specialist's behalf.
//
// ── AND IT IS ASKED ABOUT THE FACE THIS CATALOGUE IS SET IN ────────────────
//
// This module used to be about a serif, because every catalogue was. Now a
// house chooses 明體 or 黑體 (src/lib/engine/faces.ts) and the verdict inverts
// with the choice: on a 黑體 catalogue, a machine holding only the serif is
// the one seeing the wrong page, and reporting it as correct would be the
// check agreeing with the thing it exists to catch.

import type { Face } from "@/lib/engine/faces";
import { CJK_FACES } from "@/lib/render/html";

/**
 * The faces that would make the preview the catalogue, in the order the
 * document asks for them.
 *
 * THE LAST ONE IS A SANS AND IS COUNTED SEPARATELY. "Noto Sans CJK HK" is in
 * the document's stack as the last rung before tofu — a sans catalogue is a
 * compromise and tofu is a reprint — so a machine that has only that one can
 * READ the preview and is still not seeing the page. Treating it as a pass
 * would be the check quietly agreeing with the thing it exists to catch.
 */
/**
 * `faithful` — this machine holds a face that IS the one the catalogue is set
 * in, so the preview is the page. `substitute` — it holds one of the stack's
 * other rungs, so the preview is readable and is the wrong kind of face.
 * `none` — tofu.
 */
export type SerifFidelity = "faithful" | "substitute" | "none";

export interface SerifVerdict {
  fidelity: SerifFidelity;
  /** Which of the catalogue's own faces this machine actually has. */
  available: string[];
  /** One sentence, in the second person, naming what to do about it. */
  message: string;
}

/**
 * What a machine's font list means for the preview.
 *
 * PURE, taking the answer rather than asking the question, because
 * `document.fonts` does not exist in the node environment the tests run in —
 * the same split every other logic module here makes. The asking is four lines
 * in src/components/print-fidelity.tsx.
 */
export function serifVerdict(
  available: readonly string[],
  face: Face,
): SerifVerdict {
  // THE CATALOGUE'S OWN RUNGS, in the catalogue's own order — not the union
  // the component probed with. A machine holding every sans and no serif is a
  // perfect machine for a 黑體 catalogue and a warning on a 明體 one.
  const have = face.cjk.filter((named) => available.includes(named));
  const right = have.filter((named) => face.faithful.includes(named));
  if (right.length > 0) {
    return {
      fidelity: "faithful",
      available: [...have],
      message: `The preview is set in ${right[0]}, which is what the printer will get.`,
    };
  }
  if (have.length > 0) {
    return {
      fidelity: "substitute",
      available: [...have],
      message:
        `This machine has none of the ${face.name.zh} faces this catalogue is set in, so the ` +
        `preview is falling back to ${have[0]}. The printed page will be ${face.name.zh}; judge ` +
        `the type from a PDF rather than from here.`,
    };
  }
  return {
    fidelity: "none",
    available: [],
    message:
      `This machine has none of the catalogue's Traditional Chinese faces, so the preview ` +
      `is set in whatever the browser chose. Install ${face.faithful[0]}, or judge the type ` +
      `from a PDF — the export reports whether the server's own fonts painted.`,
  };
}

/** Every face to ask about, across every typeface. The component lists none. */
export { CJK_FACES };
