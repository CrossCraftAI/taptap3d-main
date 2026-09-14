import Link from "next/link";

import { EventChooser } from "@/components/event-chooser";
import { PageHeader } from "@/components/page-header";
import { listEvents } from "@/lib/data/events";
import { currentOrgOrNull } from "@/lib/data/org";

export const dynamic = "force-dynamic";

/**
 * Record → Import.
 *
 * The demo's opening move is "the client just sent me this file". Before this
 * page the only way into the importer was to remember which event it belonged
 * to, find it in the ledger and open it — three steps for the one thing M1.md
 * calls the largest risk in the business.
 *
 * It asks which event rather than choosing one, because records land in an event
 * and nothing else in the system can know which. That question is a place; the
 * answer is the event's own screen.
 */
export default async function ImportPage(): Promise<React.ReactElement> {
  const org = await currentOrgOrNull();
  const events = org ? await listEvents(org.id) : null;

  return (
    <div className="px-8 py-8">
      <PageHeader
        title="Import"
        meta={
          events === null
            ? undefined
            : events.length === 0
              ? "nowhere to put records yet"
              : `${events.length} ${events.length === 1 ? "event" : "events"} can take records`
        }
      />

      <p className="mt-3 max-w-prose text-[13px] leading-relaxed text-muted">
        A spreadsheet, a CSV, or text pasted out of an email. Every column is
        shown with a suggested field, a confidence and a reason, and nothing is
        written until you press commit — what does not fit is kept under the
        client&rsquo;s own header rather than dropped.
      </p>

      <EventChooser
        events={events}
        action={(event) => (
          <Link
            href={`/events/${event.id}/import`}
            className="border border-ruleStrong bg-paper px-2.5 py-1 text-[12px] font-medium hover:bg-field"
          >
            Import lots
          </Link>
        )}
        nothing={
          <>
            Records need somewhere to land.{" "}
            <Link href="/" className="text-seal hover:underline">
              Name an event
            </Link>{" "}
            and the file goes in next.
          </>
        }
      />
    </div>
  );
}
