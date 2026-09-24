import Link from "next/link";
import { notFound } from "next/navigation";

import {
  ConditionWorkbench,
  type PhotographChoice,
  type ViewChoice,
  type WorkbenchFault,
  type WorkbenchMark,
} from "@/components/condition-workbench";
import { ExaminationOpener, type OccasionChoice } from "@/components/examination-opener";
import { PageHeader } from "@/components/page-header";
import { listAssetsForLot } from "@/lib/data/assets";
import { getEvent } from "@/lib/data/events";
import {
  lifetimeOf,
  listExaminations,
  numberedMarks,
  REFERENCE_VIEWS,
  VIEW_LABEL,
} from "@/lib/data/examinations";
import { getLot } from "@/lib/data/lots";
import { formatDay, formatMoment, listMovements } from "@/lib/data/movements";
import { currentOrgId } from "@/lib/data/org";
import { asText } from "@/lib/engine/derive";

export const dynamic = "force-dynamic";

/**
 * Condition: a reference view on the left, the report on the right.
 *
 * It is a CONDITION REPORT. Not "conditional" — conditional means contingent on
 * something, and this document goes to bidders.
 *
 * ── WHAT THIS PAGE DOES AND WHAT THE CLIENT DOES ────────────────────────────
 *
 * Everything derived is derived here, on the server: the numbering, the
 * lifetime grouping, the formatted dates, the occasion each examination was
 * filed on. The client component owns the two things a server cannot — which
 * view is showing and which mark is selected — and sends back three gestures.
 * That split is what keeps the numbering the same on the screen and in the
 * printed report: there is one implementation and it runs once.
 */
export default async function ConditionPage({
  params,
}: {
  params: Promise<{ id: string; lotId: string }>;
}): Promise<React.ReactElement> {
  const { id, lotId } = await params;
  const orgId = await currentOrgId();
  const [event, lot] = await Promise.all([getEvent(orgId, id), getLot(orgId, lotId)]);
  if (!event || !lot || lot.eventId !== event.id) notFound();

  const [history, chain, photographs] = await Promise.all([
    listExaminations(orgId, lot.id),
    listMovements(orgId, lot.id),
    listAssetsForLot(orgId, lot.id),
  ]);

  const title = asText(lot.fields.title) || "Untitled lot";
  // THE NEWEST IS THE ONE BEING WRITTEN. `listExaminations` is oldest first,
  // because that is the order a lifetime history is built in; the screen works
  // on the last of them.
  const current = history[history.length - 1] ?? null;
  const legs = new Map(chain.map((leg) => [leg.id, leg]));
  const describeLeg = (legId: string): string | null => {
    const leg = legs.get(legId);
    if (!leg) return null;
    return `${leg.fromPlace ?? "outside the house"} → ${leg.toPlace} · ${formatDay(leg.occurredAt)}`;
  };

  const occasions: OccasionChoice[] = chain.map((leg) => ({
    id: leg.id,
    label: `${leg.fromPlace ?? "outside the house"} → ${leg.toPlace} · ${formatDay(leg.occurredAt)}`,
    examined: leg.reports > 0,
  }));

  const header = (
    <PageHeader
      parent={{ href: `/events/${event.id}/lots/${lot.id}`, label: lot.ref ?? title }}
      title={lot.ref ? `${lot.ref} · ${title}` : title}
      meta={
        <>
          {history.length === 0
            ? "never examined"
            : `${history.length} ${history.length === 1 ? "examination" : "examinations"}`}
          {current && current.marks.length > 0 && (
            <> · {current.marks.length} marks in the latest</>
          )}
        </>
      }
      actions={
        <>
          <Link
            href={`/events/${event.id}/lots/${lot.id}/movement`}
            className="inline-flex min-h-[var(--tap)] items-center border border-ruleStrong bg-paper px-3 text-[13px] font-medium hover:bg-sunk"
          >
            Movement
          </Link>
          {current && (
            /* A PLAIN ANCHOR, not a Link. The report is a document with its
               own content type and its own stylesheet — a client-side
               navigation has nowhere to put it. The same reason
               src/lib/workflow.ts `placeIsFile` exists for the PDF. */
            <a
              href={`/events/${event.id}/lots/${lot.id}/condition/report`}
              className="inline-flex min-h-[var(--tap)] items-center border border-ruleStrong bg-paper px-3 text-[13px] font-medium hover:bg-sunk"
            >
              Print the report
            </a>
          )}
        </>
      }
    />
  );

  if (!current) {
    return (
      <div className="px-8 py-8">
        {header}
        <div className="mt-6 max-w-3xl">
          <ExaminationOpener
            eventId={event.id}
            lotId={lot.id}
            occasions={occasions}
            first
          />
        </div>
      </div>
    );
  }

  const marks: WorkbenchMark[] = numberedMarks(current.marks).map((mark) => ({
    id: mark.id,
    view: mark.view,
    number: mark.number,
    x: mark.x,
    y: mark.y,
    note: mark.note,
  }));

  const lifetime: WorkbenchFault[] = lifetimeOf(history).map((fault) => ({
    view: fault.view,
    number: fault.number,
    x: fault.x,
    y: fault.y,
    sightings: fault.sightings.map((sighting) => ({
      at: formatDay(sighting.at),
      examiner: sighting.examiner,
      note: sighting.note,
      first: sighting.first,
    })),
  }));

  const views: ViewChoice[] = REFERENCE_VIEWS.map((view) => {
    const hash = current.views[view];
    return {
      view,
      label: VIEW_LABEL[view],
      src: hash ? `/api/assets/${hash}` : null,
      caption: hash
        ? `Reference view · ${VIEW_LABEL[view].toLowerCase()}`
        : `Reference view · ${VIEW_LABEL[view].toLowerCase()} · no photograph yet`,
    };
  });

  const choices: PhotographChoice[] = photographs.map((photograph) => ({
    id: photograph.id,
    label:
      photograph.originalName ??
      `${photograph.contentHash.slice(0, 10)} · ${photograph.mimeType}`,
  }));

  return (
    <div className="px-8 py-8">
      {header}

      {/* KEYED ON THE EXAMINATION, so opening a new one gives a new workbench.
          The report's fields are uncontrolled inputs — they keep their DOM
          values across a re-render — and without this the second examination
          would open showing the first examiner's name and light, which is the
          one thing a dated document must not do. The same remount-on-version
          mechanism the lot form uses. */}
      <ConditionWorkbench
        key={current.id}
        eventId={event.id}
        lotId={lot.id}
        views={views}
        examination={{
          id: current.id,
          at: formatMoment(current.at),
          examiner: current.examiner,
          light: current.light,
          summary: current.summary,
          occasion: current.movementId ? describeLeg(current.movementId) : null,
        }}
        examinationCount={history.length}
        marks={marks}
        lifetime={lifetime}
        photographs={choices}
      />

      <div className="mt-10 max-w-3xl">
        <ExaminationOpener
          eventId={event.id}
          lotId={lot.id}
          occasions={occasions}
          first={false}
        />
      </div>
    </div>
  );
}
