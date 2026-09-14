import Link from "next/link";

import { EventChooser } from "@/components/event-chooser";
import { PageHeader } from "@/components/page-header";
import { listEvents } from "@/lib/data/events";
import { currentOrgOrNull } from "@/lib/data/org";

export const dynamic = "force-dynamic";

/**
 * Publish → PDF export.
 *
 * DFD.md §6 calls the print PDF "the deliverable that pays for the software
 * today", and until now the only way to reach it was through the editor. Someone
 * sending last week's settled catalogue to the printer should not have to open
 * the editor to do it — that is the difference between composing and publishing,
 * and it is why they are different categories on the rail.
 *
 * The route is `/exports` rather than `/exports/pdf` because the PDF is the only
 * output that exists. The tearsheet and the price list landed as TEMPLATES
 * (ROADMAP D6) rather than as outputs of their own: the catalogue screen chooses
 * one and this same link prints whichever is chosen, through the same renderer.
 * The label and the per-lot embed are D2–D4; when one lands it is a column
 * here, not a new place, and nothing has to be renamed.
 *
 * An event with no lots gets no link at all. A Chromium launch that prints an
 * empty document is four seconds and 2 GB spent saying nothing.
 */
export default async function ExportsPage(): Promise<React.ReactElement> {
  const org = await currentOrgOrNull();
  const events = org ? await listEvents(org.id) : null;
  const printable = events?.filter((event) => event.lotCount > 0).length ?? 0;

  return (
    <div className="px-8 py-8">
      <PageHeader
        title="PDF export"
        meta={
          events === null
            ? undefined
            : printable === 0
              ? "nothing to print yet"
              : `${printable} ready to print`
        }
      />

      <p className="mt-3 max-w-prose text-[13px] leading-relaxed text-muted">
        The same document the preview shows, printed — one renderer behind both,
        so what arrives at the printer is what was on screen, on whichever
        template the catalogue has chosen. One export at a time, and the first
        after a quiet spell pays for starting the browser.
      </p>

      <EventChooser
        events={events}
        action={(event) =>
          event.lotCount === 0 ? (
            <span className="text-[12px] text-faint">no lots yet</span>
          ) : (
            // A plain anchor, not a Link: the answer is a stream of bytes with
            // its own content-type, and a client-side navigation has nowhere to
            // put it.
            <a
              href={`/events/${event.id}/catalogue/pdf`}
              className="border border-ruleStrong bg-paper px-2.5 py-1 text-[12px] font-medium hover:bg-field"
            >
              Download PDF
            </a>
          )
        }
        nothing={
          <>
            Nothing has been catalogued yet.{" "}
            <Link href="/" className="text-seal hover:underline">
              Name an event
            </Link>{" "}
            to start one.
          </>
        }
      />
    </div>
  );
}
