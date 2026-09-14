"use client";

import { useRef, useState } from "react";

import { setStageAction } from "@/app/events/[id]/actions";
import { StageSegments } from "@/components/stage";
import { logAction } from "@/lib/log/client";
import type { StageReading } from "@/lib/workflow";

/**
 * Where the sale is — as the data says, or as a person says.
 *
 * One select. Its first option is the derived answer, named, so choosing it is
 * how an override is taken back: the reversal lives in the same control as the
 * decision, and nobody has to find a second one (principle 9). Every other
 * option pins a stage by hand, and the option text says so, which is why the
 * closed control needs no separate mark — it reads "Catalogued · set by hand"
 * or "Recorded · from the data" and nothing else.
 *
 * CONTROLLED, and the server is the source of truth. The form posts one field,
 * so the stale-sibling bug the catalogue controls hit cannot happen here — but
 * the discipline is the same: local state so the control moves in the frame
 * the pointer does, and authority returned by REMOUNT (the parent keys this on
 * the stored value), never by syncing a prop into state.
 *
 * The Set button is the path for a browser that has not run the bundle; every
 * change submits on its own where it has. Same as the catalogue controls.
 */
export function StageControl({
  eventId,
  reading,
}: {
  eventId: string;
  reading: StageReading;
}): React.ReactElement {
  const form = useRef<HTMLFormElement>(null);
  const [value, setValue] = useState(reading.overridden ? reading.stage.id : "");
  const steps = reading.workflow.stages.length - 1;

  const change = (next: string): void => {
    setValue(next);
    // Counted (principle 5): a person overruling the derivation is exactly the
    // gesture that says the default was wrong for this house.
    logAction("event.stage", { eventId, stage: next || null });
    queueMicrotask(() => form.current?.requestSubmit());
  };

  return (
    <form
      ref={form}
      action={setStageAction.bind(null, eventId)}
      className="inline-flex items-center gap-2"
    >
      <StageSegments filled={reading.index} of={steps} />
      <select
        name="stage"
        aria-label="Stage"
        value={value}
        onChange={(e) => change(e.target.value)}
        className="border border-rule bg-paper px-1.5 py-0.5 text-[12px] text-ink"
      >
        <option value="">{reading.derived.label.en} · from the data</option>
        {reading.workflow.stages.map((stage) => (
          <option key={stage.id} value={stage.id}>
            {stage.label.en} · set by hand
          </option>
        ))}
      </select>
      <button
        type="submit"
        className="border border-rule px-1.5 py-0.5 text-[11px] text-muted hover:text-ink"
      >
        Set
      </button>
    </form>
  );
}
