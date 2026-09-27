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
// A third option, deleting the dead `--font-serif` token from
// src/app/globals.css, is the right tidy-up and is somebody else's file this
// cycle. It is unreferenced by any component; whoever owns that file should
// either spend it on the application's own serif or remove it.
//
// So: the machine is asked, and what it answers is SHOWN. That is also the
// honest version of principle 10 — measure, don't assert — applied to the one
// claim this product cannot make on the specialist's behalf.

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
const SERIF_FACES = CJK_FACES.filter((face) => !face.includes("Sans"));

export type SerifFidelity = "serif" | "sans" | "none";

export interface SerifVerdict {
  fidelity: SerifFidelity;
  /** Which of the document's faces this machine actually has. */
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
export function serifVerdict(available: readonly string[]): SerifVerdict {
  const have = CJK_FACES.filter((face) => available.includes(face));
  const serif = have.filter((face) => SERIF_FACES.includes(face));
  if (serif.length > 0) {
    return {
      fidelity: "serif",
      available: [...have],
      message: `The preview is set in ${serif[0]}, which is what the printer will get.`,
    };
  }
  if (have.length > 0) {
    return {
      fidelity: "sans",
      available: [...have],
      message:
        `This machine has no Traditional Chinese SERIF from the catalogue's stack, so the ` +
        `preview is falling back to ${have[0]}. The printed page will be a serif; judge the ` +
        `type from a PDF rather than from here.`,
    };
  }
  return {
    fidelity: "none",
    available: [],
    message:
      "This machine has none of the catalogue's Traditional Chinese faces, so the preview " +
      "is set in whatever the browser chose. Install Noto Serif CJK HK, or judge the type " +
      "from a PDF — the export reports whether the server's own fonts painted.",
  };
}

/** The faces to ask about. Exported so the component lists nothing itself. */
export { CJK_FACES };
