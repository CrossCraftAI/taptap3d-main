import { StageCell } from "@/components/stage";
import { factsOf, type EventSummary } from "@/lib/data/events";
import { readStage, type Workflow } from "@/lib/workflow";

/**
 * "Which one?" — the question every place that acts on a sale has to ask first.
 *
 * The rail holds places, not actions. A global *Catalogues* or *Exports* cannot
 * know which sale a specialist means, and picking one for them is exactly the
 * hoisting that keeps an event's own buttons on the event's own header. So each
 * of those places opens on the ledger and hands off to the event's screen, where
 * the action has always lived.
 *
 * ONE COMPONENT RATHER THAN TWO TABLES. The columns are the operator's progress
 * indicators — lots in, lots photographed, and where the sale is — and copies
 * of them would drift apart the first time one screen learned something the
 * others did not. The landing keeps its own table because it carries quick-add
 * inside it and the stage's own next action, which is a different shape and the
 * one place an event is created.
 */

function formatDate(value: Date | null): string {
  return value
    ? new Intl.DateTimeFormat("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        // The catalogue is produced in Hong Kong, so a date is read there. A
        // server in another zone must not shift a sale by a day.
        timeZone: "Asia/Hong_Kong",
      }).format(value)
    : "—";
}

export function EventChooser({
  events,
  workflow,
  action,
  nothing,
}: {
  /** Null when no organisation resolved — the chrome renders and says why. */
  events: EventSummary[] | null;
  /** The house's workflow, which the Progress column reads. */
  workflow: Workflow;
  /** What this place does to the event. The only link in the row. */
  action: (event: EventSummary) => React.ReactNode;
  /** What to say to an org that has no events at all. */
  nothing: React.ReactNode;
}): React.ReactElement {
  if (events === null) {
    return (
      <p className="mt-5 border border-rule bg-paper px-4 py-10 text-center text-[13px] leading-relaxed text-muted">
        Every row in this system carries the organisation that owns it, so there
        is nothing to choose between until one exists. Create it with{" "}
        <code className="bg-sunk px-1 py-0.5 text-[12px]">npm run db:seed</code>.
      </p>
    );
  }

  return (
    <div className="mt-5 border border-rule bg-paper">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-rule text-left text-[11px] tracking-wide text-muted">
            <th className="px-4 py-2 font-medium">Event</th>
            <th className="w-32 px-4 py-2 font-medium">Date</th>
            <th className="w-24 px-4 py-2 text-right font-medium">Lots</th>
            <th className="w-32 px-4 py-2 text-right font-medium">
              Photographed
            </th>
            <th className="w-52 px-4 py-2 font-medium">Progress</th>
            <th className="w-40 px-4 py-2 text-right font-medium">
              <span className="sr-only">Action</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {events.map((event) => (
            <tr
              key={event.id}
              className="border-b border-rule last:border-b-0 hover:bg-field"
            >
              <td className="max-w-0 truncate px-4 py-2.5 font-medium">
                {event.name}
              </td>
              <td className="px-4 py-2.5 text-muted">
                {formatDate(event.heldOn)}
              </td>
              <td className="px-4 py-2.5 text-right" data-numeric>
                {event.lotCount === 0 ? (
                  <span className="text-faint">—</span>
                ) : (
                  event.lotCount
                )}
              </td>
              <td className="px-4 py-2.5 text-right" data-numeric>
                {event.lotCount === 0 ? (
                  <span className="text-faint">—</span>
                ) : (
                  <span
                    className={
                      event.photographedCount === event.lotCount
                        ? "text-ink"
                        : "text-muted"
                    }
                  >
                    {event.photographedCount}
                    <span className="text-faint"> / {event.lotCount}</span>
                  </span>
                )}
              </td>
              <td className="px-4 py-2.5">
                <StageCell
                  reading={readStage(workflow, factsOf(event), event.stageOverride)}
                />
              </td>
              <td className="px-4 py-2.5 text-right">{action(event)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {events.length === 0 && (
        <p className="px-4 py-8 text-center text-[13px] leading-relaxed text-muted">
          {nothing}
        </p>
      )}
    </div>
  );
}
