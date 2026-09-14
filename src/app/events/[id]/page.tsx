import Link from "next/link";
import { notFound } from "next/navigation";

import { NextAction } from "@/components/stage";
import { StageControl } from "@/components/stage-control";
import { asText } from "@/lib/engine/derive";
import { factsOf, getEventSummary } from "@/lib/data/events";
import { listLotsWithImages } from "@/lib/data/lots";
import { currentOrgId } from "@/lib/data/org";
import { workflowOf } from "@/lib/data/workflow";
import { placeHref, readStage, type Place } from "@/lib/workflow";

export const dynamic = "force-dynamic";

/**
 * The places an event's header always offers, whatever stage it is at.
 *
 * The stage's own action comes first, as the one seal on the page; these follow
 * it, minus whichever one it already is. So a sale being photographed reads
 * [Add photographs] [Import lots] [Catalogue], and a sale ready to lay out reads
 * [Open catalogue] [Import lots] — the standing buttons never disappear because
 * of the stage, they only avoid saying the same thing twice. Nothing is gated:
 * the catalogue opens on an empty sale and says so itself.
 */
const STANDING: { label: string; to: Place }[] = [
  { label: "Import lots", to: "import" },
  { label: "Catalogue", to: "catalogue" },
];

export default async function EventPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.ReactElement> {
  const { id } = await params;
  const orgId = await currentOrgId();
  // The SAME counts the ledger shows, from the same SQL, so the stage here and
  // the stage there cannot disagree about one sale.
  const [event, lots, workflow] = await Promise.all([
    getEventSummary(orgId, id),
    listLotsWithImages(orgId, id),
    workflowOf(orgId),
  ]);
  if (!event) notFound();

  const reading = readStage(workflow, factsOf(event), event.stageOverride);

  return (
    <div className="px-8 py-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <Link
            href="/"
            className="text-[12px] text-muted hover:text-seal hover:underline"
          >
            Events
          </Link>
          <h1 className="mt-1 truncate text-[19px] font-semibold tracking-tight">
            {event.name}
          </h1>
          <div
            className="mt-1.5 flex flex-wrap items-center gap-2 text-[12px] text-muted"
            data-numeric
          >
            {/* KEYED ON THE STORED ANSWER, so when the action lands the control
                is new and reads the server's value — the remount reset, not a
                prop synced into state. */}
            <StageControl
              key={event.stageOverride ?? ""}
              eventId={event.id}
              reading={reading}
            />
            <span>
              ·{" "}
              {event.lotCount === 0
                ? "No lots yet"
                : `${event.lotCount} lots · ${event.photographedCount} photographed`}
            </span>
          </div>
        </div>

        <div className="flex gap-2">
          {/* THE PRIMARY ACTION IS THE STAGE'S. It used to say "Import lots"
              on every sale, including the one whose lots were all in and
              photographed — a button that never changes is a button nobody
              reads. The label and destination come from the workflow; this
              page knows neither. */}
          <NextAction reading={reading} eventId={event.id} primary />
          {STANDING.filter((s) => s.to !== reading.stage.next.to).map((s) => (
            <Link
              key={s.to}
              href={placeHref(s.to, event.id)}
              className="border border-ruleStrong bg-paper px-3 py-1.5 text-[13px] font-medium hover:bg-field"
            >
              {s.label}
            </Link>
          ))}
        </div>
      </header>

      {lots.length === 0 ? (
        /* AN EMPTY SCREEN IS AN INVITATION TO ACT, and it offers exactly one
           action because there is exactly one sensible next move. This is the
           empty-lots state, not a workflow stage: whatever a house's workflow
           says, a sale with no lots needs lots. */
        <div className="mt-6 border border-rule bg-paper px-8 py-16 text-center">
          <p className="text-[14px] font-medium">This event has no lots.</p>
          <p className="mx-auto mt-2 max-w-md text-[13px] leading-relaxed text-muted">
            Import the file the client sent. A spreadsheet or a CSV goes straight
            in; anything else, paste the list as text and the same screen reads
            it.
          </p>
          <Link
            href={`/events/${event.id}/import`}
            className="mt-5 inline-block bg-seal px-4 py-2 text-[13px] font-medium text-white hover:bg-[#8d241f]"
          >
            Import lots
          </Link>
        </div>
      ) : (
        <div className="mt-6 border border-rule bg-paper">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-rule text-left text-[11px] tracking-wide text-muted">
                <th className="w-28 px-4 py-2 font-medium">Ref</th>
                <th className="px-4 py-2 font-medium">Title</th>
                <th className="w-44 px-4 py-2 font-medium">Maker</th>
                <th className="w-52 px-4 py-2 font-medium">Estimate</th>
                <th className="w-20 px-4 py-2 text-right font-medium">Photos</th>
              </tr>
            </thead>
            <tbody>
              {lots.map((lot) => (
                <tr
                  key={lot.id}
                  className="border-b border-rule last:border-b-0 hover:bg-field"
                >
                  <td className="px-4 py-2 font-medium" data-numeric>
                    <Link
                      href={`/events/${event.id}/lots/${lot.id}`}
                      className="hover:text-seal hover:underline"
                    >
                      {lot.ref ?? <span className="text-faint">—</span>}
                    </Link>
                  </td>
                  <td className="max-w-0 truncate px-4 py-2">
                    <Link
                      href={`/events/${event.id}/lots/${lot.id}`}
                      className="hover:text-seal hover:underline"
                    >
                      {asText(lot.fields.title) || (
                        <span className="text-faint">untitled</span>
                      )}
                    </Link>
                  </td>
                  <td className="max-w-0 truncate px-4 py-2 text-muted">
                    {asText(lot.fields.maker) || "—"}
                  </td>
                  <td className="max-w-0 truncate px-4 py-2 text-muted">
                    {asText(lot.fields.price) || "—"}
                  </td>
                  <td className="px-4 py-2 text-right" data-numeric>
                    {lot.images.length === 0 ? (
                      <span className="text-faint">—</span>
                    ) : (
                      lot.images.length
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
