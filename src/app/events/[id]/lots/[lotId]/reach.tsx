// How far a value goes, said in one badge.
//
// Colocated with the lot record rather than put in src/components, because
// nothing outside this screen shows it yet and Next treats a non-route file in
// a route segment as an ordinary module. It carries no "use client" directive
// and no state, so the server page and the two client forms beside it can all
// render the same badge — which is the point: three places on one screen say
// where a value goes, and they must not say it three ways.
//
// ── WHY A BADGE AND NOT A COLUMN ────────────────────────────────────────────
//
// The default is that a house has no policy and every field is public, so the
// common row must cost nothing. A column headed "Reach" would be an empty
// column on every row of every record in every house that has not set one. A
// badge that is simply absent at `public` adds no width, no header and no
// pixel until somebody has actually marked a field.
//
// ── THE MOCKUP'S PADLOCK, DRAWN RATHER THAN TYPED ───────────────────────────
//
// The drawing carries an emoji — 🔒 Never leaves the building — beside the
// reserve and the consignor. The words are kept verbatim because they are the
// clearest sentence anybody has written about what `house` means. The emoji is
// not: nothing else in this application is one, an emoji is a different
// typeface on every platform and a different size on each, and it cannot take
// the badge's colour. So it is the same stroked, unfilled, currentColor glyph
// the rail and the lot stepper draw with.

import type { Audience } from "@/lib/engine/visibility";

/**
 * What each level is called on screen, and what it means in one line.
 *
 * NOT IN `CORE_FIELDS` AND NOT IN A TEMPLATE. Those two are the house's own
 * nouns for its own data and belong to the vocabulary layer (Phase 10); these
 * three are this system's names for a rule it enforces, in the same class as
 * "override" and "pin". A house renaming its 底價 column does not rename
 * `internal`.
 *
 * TWO STRINGS PER LEVEL, because the same word is read in two grammars. The
 * NAME is the level itself and is the word stored in the column — "Made for
 * house", "house · 8 of 8 values" — and it must be the stored word or a person
 * reading the screen cannot find the thing they are reading about. The BADGE
 * is what a marked field wears beside it, where the reader wants the
 * consequence and not the label: the drawing's own "Never leaves the building"
 * is the best sentence anybody has written for `house`, and "Made for Never
 * leaves the building" is not a sentence at all.
 */
export const LEVEL_WORDS: Record<Audience, { name: string; badge: string; means: string }> = {
  public: {
    name: "public",
    badge: "public",
    means: "Anyone may read it — the catalogue, the listing, a wall label.",
  },
  internal: {
    name: "internal",
    badge: "internal only",
    means:
      "Only an output made for the house and the people it is doing this lot's business with.",
  },
  house: {
    name: "house",
    badge: "Never leaves the building",
    means: "The house alone. No output made for anybody else carries it.",
  },
};

/** A padlock, drawn the way the rail's chevron is: stroked, square, no fill. */
function Padlock(): React.ReactElement {
  return (
    <svg
      aria-hidden="true"
      width="10"
      height="10"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      className="shrink-0"
    >
      <rect x="2.5" y="6" width="9" height="6.5" />
      <path d="M4.6 6V4.2a2.4 2.4 0 0 1 4.8 0V6" />
    </svg>
  );
}

/**
 * Where this value goes. NULL at `public`, which is every field of every house
 * that has not set a policy.
 *
 * NULL AND NOT AN EMPTY SPAN, and that is load-bearing rather than tidy: the
 * record's rows are a flex box with a `gap-4`, and an empty element is still a
 * flex item, so a badge that rendered nothing would still have pushed sixteen
 * pixels of air onto every row of every record in the product. The caller
 * places this directly in the flex row and passes its own spacing through
 * `className`, so at `public` there is no element and therefore no gap.
 */
export function Reach({
  level,
  className = "",
}: {
  level: Audience;
  className?: string;
}): React.ReactElement | null {
  if (level === "public") return null;
  const words = LEVEL_WORDS[level];
  const tone =
    level === "house"
      ? "bg-sealSoft text-seal"
      : "border border-rule text-muted";
  return (
    <span
      title={words.means}
      className={`inline-flex shrink-0 items-center gap-1 px-1 py-px text-[10px] font-medium ${tone} ${className}`}
    >
      {level === "house" && <Padlock />}
      {words.badge}
    </span>
  );
}
