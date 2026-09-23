import Link from "next/link";

import { placeHref, placeIsFile, shortfallOf, type StageReading } from "@/lib/workflow";

/**
 * Where a sale is, in one cell: how far along the ordered stages it is, the
 * stage's name, and what the next stage is still waiting for. Read wherever
 * events are listed, so every ledger in the system says the same thing about
 * the same sale.
 *
 * ── THE NAME IS HALF A CELL ─────────────────────────────────────────────────
 *
 * This file used to argue at length about the indicator's colour and not once
 * about the label, and the label was the half that was wrong: a stage is a
 * STATE, so "Recorded" reads identically for a sale with one plate of two
 * hundred and one with a hundred and ninety-nine. The drawing never said only
 * the state — its cell was "Receive · 87 without a condition check" — and the
 * quantifier had ended up two columns away in the lot counts, where it is
 * about the inventory and not about the step.
 *
 * So the shortfall is appended, and it is DERIVED (`shortfallOf`,
 * src/lib/workflow.ts) from the next stage's own conditions rather than
 * written per stage here: a house authors its own workflow, and a sentence
 * that only fits the built-in is a sentence that breaks the day one does.
 *
 * THE STAGE NAME KEEPS ITS OWN ELEMENT, which is not cosmetic. It is the thing
 * a person scans down the column and the thing a driven test addresses by
 * exact text; a cell whose only text node is "Recorded · 6 without a
 * photograph" has no stage name in it to find.
 *
 * ── THE INDICATOR COUNTS STEPS, AND SAYS WHICH ARE DONE ─────────────────────
 *
 * One segment per STEP between stages, not per stage: a sale that has only
 * been named shows nothing filled, which is the truth, rather than one block
 * of five for having a row.
 *
 * Done segments are `--go`, the rest are `--rule`. This shipped as ink on grey
 * on the argument that a third colour would be "a rainbow beside a column of
 * numbers" — and put beside the drawing it read as texture rather than as
 * progress, because two greys a column apart are two greys. The owner settled
 * it: green for done. The argument was right about the ACCENT and wrong about
 * this; `--go` is not an accent, it asks for nothing, and the pair is a
 * sentence — NOTHING IS BOTH FINISHED AND WAITING.
 *
 * THE ACCENT IS STILL SPENT ELSEWHERE: the row's call to action, and only on
 * the sales somebody is part-way through (`isMidJob`, src/lib/workflow.ts). It
 * used to be spent on no row at all, on the argument that sixty red buttons in
 * a column is no seal — which is right about sixty and wrong about two. The
 * indicator stays out of it: the accent says "a person is needed here", and a
 * bar saying how far along a sale is is not asking anybody for anything.
 *
 * ── THE MARK FOR A HUMAN ANSWER ─────────────────────────────────────────────
 *
 * When a person set the stage, the cell says so, in the same mark the lot page
 * uses for a value that is not the record's. Principle 9: an automatic value
 * and a human one must be tellable apart, or neither can be trusted. The title
 * carries what the data would have said, so the disagreement is one hover away.
 *
 * Nothing here is the built-in workflow's. The labels, the count of stages and
 * the action all come from the reading; a house-authored workflow renders the
 * same way.
 */
export function StageCell({ reading }: { reading: StageReading }): React.ReactElement {
  const steps = reading.workflow.stages.length - 1;
  const complete = reading.index === steps;
  const shortfall = shortfallOf(reading);
  const title = reading.overridden
    ? `Set by hand. From the data alone it would read ${reading.derived.label.en}.`
    : `Stage ${reading.index + 1} of ${steps + 1}, read from the event's lots, photographs, catalogue and exports.`;
  return (
    <span className="inline-flex items-center gap-2" title={title}>
      <StageSegments filled={reading.index} of={steps} />
      {/* The name and its shortfall wrap together, inside one box beside the
          segments — so a shortfall too long for the column takes a second line
          under the words and never leaves the indicator stranded on a line of
          its own. */}
      <span>
        <span className={complete ? "text-ink" : "text-muted"}>{reading.stage.label.en}</span>
        {/* 12px is the scale's quiet line (test/house-style.test.ts): the state
            is what the column is, the shortfall is what it costs. */}
        {shortfall !== null && (
          <span className="text-[12px] text-muted"> · {shortfall}</span>
        )}
      </span>
      {reading.overridden && <ByHand />}
    </span>
  );
}

/** The steps taken, as `of` small blocks with the first `filled` in ink. */
export function StageSegments({
  filled,
  of,
}: {
  filled: number;
  of: number;
}): React.ReactElement {
  return (
    <span aria-hidden="true" className="flex shrink-0 gap-px">
      {Array.from({ length: of }, (_, i) => (
        <span
          key={i}
          className={`block h-1.5 w-2 ${i < filled ? "bg-go" : "bg-rule"}`}
        />
      ))}
    </span>
  );
}

/** The same mark the lot page puts on a value that is not the record's. */
export function ByHand(): React.ReactElement {
  return (
    <span className="bg-sealSoft px-1 py-px text-[10px] font-medium text-seal">
      set by hand
    </span>
  );
}

/**
 * The stage's own next action, as a button.
 *
 * The label and the destination are the STAGE'S — nothing here knows what
 * "Import lots" is. `primary` paints it as the accent; an event's own header
 * is always primary, because there is one sale on that screen and one thing to
 * do to it. The ledger passes it only for a sale somebody is part-way through
 * (`isMidJob`), because a column of sixty filled buttons is no accent at all.
 *
 * ── ONE BOX, TWO PAINTS ─────────────────────────────────────────────────────
 *
 * The two used to be different SIZES as well as different colours — 13px with
 * a border of ink against 12px with a hairline — which is fine on a header
 * where only one of them exists and wrong in a column where they alternate:
 * the rows jump by three pixels wherever the paint changes. So the box is the
 * same and only the fill moves, and it matches the standing buttons on the
 * event's header, which is the other place these sit side by side.
 *
 * `min-h-[var(--tap)]` is the floor a finger needs; it lifts to 44px on a
 * coarse pointer (src/app/globals.css). `inline-flex` rather than
 * `inline-block` because a minimum height does nothing to an inline box.
 *
 * A file — the PDF — is a plain anchor, not a `<Link>`: the answer is a stream
 * of bytes with its own content-type, and a client-side navigation has nowhere
 * to put it.
 */
export function NextAction({
  reading,
  eventId,
  primary = false,
}: {
  reading: StageReading;
  eventId: string;
  primary?: boolean;
}): React.ReactElement {
  const { next } = reading.stage;
  const href = placeHref(next.to, eventId);
  const box =
    "inline-flex min-h-[var(--tap)] items-center whitespace-nowrap border px-3 text-[13px] font-medium";
  const className = primary
    ? `${box} border-seal bg-seal text-white hover:bg-sealPress`
    : `${box} border-ruleStrong bg-paper hover:bg-sunk`;
  if (placeIsFile(next.to)) {
    return (
      <a href={href} className={className}>
        {next.label.en}
      </a>
    );
  }
  return (
    <Link href={href} className={className}>
      {next.label.en}
    </Link>
  );
}
