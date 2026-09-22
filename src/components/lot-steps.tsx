"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect } from "react";

import type { LotNeighbour, LotStep } from "@/lib/data/lots";
import { isTyping } from "@/lib/keys";
import { logAction } from "@/lib/log/client";

/**
 * Forward and back through the lots of one sale.
 *
 * ── WHY THIS IS NOT A NICETY ─────────────────────────────────────────────────
 *
 * A sale is 128 lots and the work is per lot. Without this, every lot costs
 * three gestures to reach — back to the sale, find the row again in a table
 * that has scrolled, click it — and the middle one is the expensive one,
 * because a person who has lost their place in a 128-row table has to read it.
 * Two buttons turn a day of that into an afternoon. The predecessor's
 * competitor has had it for years.
 *
 * ── DISABLED AT THE ENDS, NEVER WRAPPING ─────────────────────────────────────
 *
 * Rejected: wrapping past the last lot back to the first. It is one line less
 * code and it is the surprise that costs the most — somebody stepping steadily
 * down a sale arrives at lot 1 believing they are at lot 129, and the next
 * twenty edits go to lots they have already done. The end of the list has to
 * feel like an end.
 *
 * A LINK WHERE THERE IS SOMEWHERE TO GO, A BUTTON WHERE THERE IS NOT. This is
 * a navigation, so it is a link: it prefetches, it opens in a new tab on a
 * middle click, and it works in the moment before the bundle has landed. But
 * there is no such thing as a disabled link — `aria-disabled` on an anchor
 * still takes focus and still navigates when something else handles the key —
 * so the end of the sale renders the one element that can genuinely be
 * disabled. Both carry the same accessible name, so the only thing that
 * changes at the ends is what the control IS.
 *
 * ── THE KEYBOARD ─────────────────────────────────────────────────────────────
 *
 * Bare ← and →. The shell rejected bare keys for its rail (Ctrl+\) because
 * `[` is a character somebody types; an arrow is not, and the field guard in
 * src/lib/keys.ts — shared with the shell, not copied — takes the rest of that
 * risk away. Rejected: Alt+arrow and ⌘+arrow, which are the browser's Back and
 * Forward and would step and go back at once. Rejected: J/K, which is two more
 * characters somebody types and means nothing outside a mail client.
 *
 * `preventDefault` only once a step is actually going to happen, so at the
 * ends the key still does whatever the browser does with it rather than
 * silently dying.
 *
 * ALREADY CLAIMED, AND THE CLASH IS DATED. src/lib/editor/drag-geometry.ts
 * `nudgeDelta` maps a bare arrow to a 1px nudge of the selected part and
 * Shift+arrow to 10px (landed at b300787, wired to nothing yet). The stepper
 * refuses every modifier, so the coarse nudge survives the collision and the
 * fine one does not: when the editor's pointer layer arrives, a bare arrow has
 * to mean the selection when there is one and the sale when there is not, and
 * that decision belongs to whoever wires the overlay, not to a guess made
 * here. The field guard below does not help — a canvas selection is not a
 * field.
 *
 * Focus is deliberately NOT chased across the step. When the last step lands
 * on lot 1 the Previous link becomes a disabled button and focus falls to the
 * body — which costs nothing here, because the listener is on the window and
 * the arrows keep working from anywhere. The shell had to chase focus for the
 * opposite reason: its button was the only way back.
 */
export function LotSteps({
  eventId,
  step,
}: {
  eventId: string;
  step: LotStep;
}): React.ReactElement {
  const router = useRouter();

  // The pointer's path is the Link's own; this is the key's. Counted the same
  // way and distinguished by `by` (principle 5) — whether the stepper is used
  // at all, and whether anyone reaches for the keyboard, is the whole question
  // behind pulling this forward, and it cannot be asked retrospectively.
  const stepByKey = useCallback(
    (to: LotNeighbour): void => {
      logAction("lot.step", { eventId, to: to.id, by: "key" });
      router.push(`/events/${eventId}/lots/${to.id}`);
    },
    [eventId, router],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const back = event.key === "ArrowLeft";
      if (!back && event.key !== "ArrowRight") return;
      if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
      if (event.repeat || event.defaultPrevented) return;
      if (isTyping(event.target)) return;
      const to = back ? step.prev : step.next;
      if (!to) return;
      event.preventDefault();
      stepByKey(to);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [stepByKey, step.prev, step.next]);

  return (
    // items-stretch: the buttons take the height of whatever else the header's
    // action row holds, so a change to that row's padding needs no change
    // here. BOX carries a min-height and not a height, which is what makes the
    // stretch possible — the 30px is a floor for the case where these are the
    // only things in the row, not the size they are.
    <nav aria-label="Step between lots" className="flex items-stretch gap-1">
      <Step eventId={eventId} to={step.prev} back />
      <Step eventId={eventId} to={step.next} back={false} />
      <span
        className="self-center whitespace-nowrap pl-1.5 text-[12px] text-muted"
        data-numeric
      >
        Lot {step.index} of {step.total}
      </span>
    </nav>
  );
}

const BOX =
  "flex min-h-[30px] w-[28px] items-center justify-center border border-ruleStrong bg-paper text-muted";

function Step({
  eventId,
  to,
  back,
}: {
  eventId: string;
  to: LotNeighbour | null;
  back: boolean;
}): React.ReactElement {
  const label = back ? "Previous lot" : "Next lot";
  const key = back ? "←" : "→";

  if (!to) {
    return (
      <button
        type="button"
        disabled
        aria-label={label}
        title={back ? "This is the first lot" : "This is the last lot"}
        className={`${BOX} disabled:opacity-40`}
      >
        <Chevron back={back} />
      </button>
    );
  }

  return (
    <Link
      href={`/events/${eventId}/lots/${to.id}`}
      aria-label={label}
      title={to.ref ? `${label}: ${to.ref} (${key})` : `${label} (${key})`}
      // The click is counted here rather than in `go`, because a Link that is
      // middle-clicked or opened in a new tab never reaches the router.
      onClick={() => logAction("lot.step", { eventId, to: to.id, by: "button" })}
      className={`${BOX} hover:bg-field hover:text-ink`}
    >
      <Chevron back={back} />
    </Link>
  );
}

/** A chevron, drawn the way the rail's glyph is: stroked, square, no fill. */
function Chevron({ back }: { back: boolean }): React.ReactElement {
  return (
    <svg
      aria-hidden="true"
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
    >
      <polyline points={back ? "9,2 4,7 9,12" : "5,2 10,7 5,12"} />
    </svg>
  );
}
