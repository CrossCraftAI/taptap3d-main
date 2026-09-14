import Link from "next/link";

import { EventChooser } from "@/components/event-chooser";
import { PageHeader } from "@/components/page-header";
import { listEvents } from "@/lib/data/events";
import { currentOrgOrNull } from "@/lib/data/org";

export const dynamic = "force-dynamic";

/**
 * Compose → Catalogue. The flagship, given a front door.
 *
 * A catalogue is a CHILD of an event rather than the event itself (DFD.md §3),
 * which is what makes one catalogue spanning two sessions, a re-issue, or an
 * event that never produces one at all expressible without touching the schema.
 * So this lists events and speaks of their catalogue, rather than listing
 * `catalogues` rows: the row is created the moment someone opens the editor, and
 * an index built on it would quietly omit every sale nobody had opened yet —
 * which is precisely the set a person comes here looking for.
 */
export default async function CataloguesPage(): Promise<React.ReactElement> {
  const org = await currentOrgOrNull();
  const events = org ? await listEvents(org.id) : null;

  return (
    <div className="px-8 py-8">
      <PageHeader
        title="Catalogues"
        meta={
          events === null
            ? undefined
            : events.length === 0
              ? "nothing in production"
              : `${events.length} ${events.length === 1 ? "event" : "events"} in production`
        }
      />

      <p className="mt-3 max-w-prose text-[13px] leading-relaxed text-muted">
        The engine places every lot so nobody places five hundred boxes by hand.
        Density and fit are parameters, not a layout you have to redo — a
        correction is a value the engine re-applies, so it survives the next
        change of density.
      </p>

      <EventChooser
        events={events}
        action={(event) => (
          <Link
            href={`/events/${event.id}/catalogue`}
            className="border border-ruleStrong bg-paper px-2.5 py-1 text-[12px] font-medium hover:bg-field"
          >
            Open catalogue
          </Link>
        )}
        nothing={
          <>
            A catalogue belongs to an event.{" "}
            <Link href="/" className="text-seal hover:underline">
              Name one
            </Link>{" "}
            and its pages are three steps away.
          </>
        }
      />
    </div>
  );
}
