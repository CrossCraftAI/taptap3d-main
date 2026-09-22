import Link from "next/link";

import { placeHref, placeIsFile, type StageReading } from "@/lib/workflow";

/**
 * Where a sale is, in one cell: how far along the ordered stages it is, and the
 * stage's name. Read wherever events are listed, so every ledger in the system
 * says the same thing about the same sale.
 *
 * ── THE INDICATOR IS GREY, AND COUNTS STEPS ─────────────────────────────────
 *
 * One segment per STEP between stages, not per stage: a sale that has only
 * been named shows nothing filled, which is the truth, rather than one block
 * of five for having a row. Filled segments are ink and empty ones are the
 * rule colour, and there is no third colour — a progress indicator that turned
 * green or amber would be a rainbow beside a column of numbers, and the accent
 * is spent elsewhere.
 *
 * WHERE IT IS SPENT: the row's call to action, and only on the sales somebody
 * is part-way through (`isMidJob`, src/lib/workflow.ts). It used to be spent
 * on no row at all, on the argument that sixty red buttons in a column is no
 * seal — which is right about sixty and wrong about two. The indicator stays
 * out of it either way: the accent says "a person is needed here", and a bar
 * that says how far along a sale is is not asking anybody for anything.
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
  const title = reading.overridden
    ? `Set by hand. From the data alone it would read ${reading.derived.label.en}.`
    : `Stage ${reading.index + 1} of ${steps + 1}, read from the sale's lots, photographs, catalogue and exports.`;
  return (
    <span className="inline-flex items-center gap-2" title={title}>
      <StageSegments filled={reading.index} of={steps} />
      <span className={complete ? "text-ink" : "text-muted"}>{reading.stage.label.en}</span>
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
          className={`block h-1.5 w-2 ${i < filled ? "bg-ink" : "bg-rule"}`}
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
