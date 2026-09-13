import Link from "next/link";

import { createEventAction } from "@/app/actions";
import { listEvents } from "@/lib/data/events";
import { currentOrgOrNull } from "@/lib/data/org";

export const dynamic = "force-dynamic";

function formatDate(value: Date | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Hong_Kong",
  }).format(value);
}

export default async function EventsPage(): Promise<React.ReactElement> {
  const org = await currentOrgOrNull();

  if (!org) {
    return (
      <div className="mx-auto max-w-lg px-8 py-20">
        <h1 className="text-lg font-semibold">No organisation yet</h1>
        <p className="mt-2 text-[13px] leading-relaxed text-muted">
          Every row in this system carries the organisation that owns it, so
          there is nothing to show until one exists. Create it with{" "}
          <code className="bg-sunk px-1 py-0.5 text-[12px]">npm run db:seed</code>
          , or set <code className="bg-sunk px-1 py-0.5 text-[12px]">TAPTAP3D_ORG_SLUG</code>{" "}
          if there is more than one.
        </p>
      </div>
    );
  }

  const events = await listEvents(org.id);

  return (
    <div className="px-8 py-8">
      <header className="flex items-baseline justify-between">
        <h1 className="text-[19px] font-semibold tracking-tight">Events</h1>
        <p className="text-[12px] text-muted">
          {events.length === 0
            ? "none yet"
            : `${events.length} ${events.length === 1 ? "event" : "events"}`}
        </p>
      </header>

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
            </tr>
          </thead>

          <tbody>
            {/* QUICK-ADD IS THE NEXT BLANK LINE OF THE LEDGER, not a modal.
                An auction house's own working record is a numbered book you
                write the next line into; a dialog that covers the list you are
                reading is a worse version of that. It also means the shortcut
                from "I have a new sale" to "I am importing its lots" is one
                keystroke and one click, which is the demo's opening move. */}
            <tr className="border-b border-rule bg-field/60">
              <td className="px-4 py-2" colSpan={4}>
                <form
                  action={createEventAction}
                  className="flex flex-wrap items-center gap-2"
                >
                  <input
                    name="name"
                    required
                    placeholder="Name a new event"
                    aria-label="Event name"
                    className="min-w-0 flex-1 border border-rule bg-paper px-2.5 py-1.5 text-[13px] placeholder:text-faint"
                  />
                  <input
                    name="heldOn"
                    type="date"
                    aria-label="Date held, if known"
                    className="border border-rule bg-paper px-2.5 py-1.5 text-[13px] text-muted"
                  />
                  <button
                    type="submit"
                    className="bg-seal px-3 py-1.5 text-[13px] font-medium text-white hover:bg-[#8d241f]"
                  >
                    Create event
                  </button>
                </form>
              </td>
            </tr>

            {events.map((event) => (
              <tr
                key={event.id}
                className="border-b border-rule last:border-b-0 hover:bg-field"
              >
                <td className="px-4 py-2.5">
                  <Link
                    href={`/events/${event.id}`}
                    className="font-medium hover:text-seal hover:underline"
                  >
                    {event.name}
                  </Link>
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
              </tr>
            ))}
          </tbody>
        </table>

        {events.length === 0 && (
          <p className="px-4 py-8 text-center text-[13px] text-muted">
            Name the sale you are cataloguing and the lots go in next.
          </p>
        )}
      </div>
    </div>
  );
}
