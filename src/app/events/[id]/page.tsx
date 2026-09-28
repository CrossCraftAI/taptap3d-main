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
          <h1 className="mt-1 truncate text-[16px] font-semibold tracking-tight">
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
              className="border border-ruleStrong bg-paper px-3 py-1.5 text-[13px] font-medium hover:bg-sunk"
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
          {/* THE STATE AND THE ACTION, WITH NOTHING BETWEEN THEM. The
              paragraph that stood here explained which file formats the
              importer takes — which is the import screen's own business, and
              is said there, on the screen where somebody has a file in their
              hand. */}
          <p className="text-[15px] font-medium">This event has no lots.</p>
          <Link
            href={`/events/${event.id}/import`}
            className="mt-5 inline-block bg-seal px-4 py-2 text-[13px] font-medium text-white hover:bg-sealPress"
          >
            Import lots
          </Link>
        </div>
      ) : (
        <div className="mt-6 border border-rule bg-paper">
          {/* `table-fixed`, WITHOUT WHICH `max-w-0` DOES THE OPPOSITE OF WHAT
              IT SAYS. The cells below carry `max-w-0 truncate`, which is the
              standard way to make a table cell ellipsise — and under the
              AUTOMATIC layout it means exactly what it says: the column
              contributes zero, so the browser gives it its minimum and hands
              the slack to the fixed ones. The inspection loop caught the result
              at 768px: every title in this table was one glyph and an ellipsis
              while three columns of em-dashes kept their full width. Fixed
              layout honours the `w-*` above and gives the remainder here, which
              is what every comment around it already assumed. The condition and
              movement registers carry the same pair for the same reason. */}
          <table className="w-full table-fixed border-collapse text-[13px]">
            <thead>
              {/* ── TWO COLUMNS LEAVE BEFORE THE TITLE IS SQUEEZED ─────────
                  The fixed widths here come to 576px and the rail takes 224,
                  so on the 768px tablet this product says it supports the
                  title had about thirty pixels: the inspection loop caught
                  every row reading "粉…", one glyph and an ellipsis, on the
                  column the screen exists for.

                  A table that drops its least valuable columns is honest; a
                  table that keeps all five and shreds the one that identifies
                  the row is not. Maker is blank on most lots and the
                  photograph count is a number the lot's own page repeats, so
                  those two go and Ref, Title and Estimate stay — which is what
                  a person scans a running order for.

                  THE THRESHOLD IS 1280 AND NOT 1024, because 1024 is where the
                  measurement says it is already too tight: a 1024 window less
                  the rail and the gutters is 736px, and 576 of that is spoken
                  for before the title gets a pixel. Chosen by re-running the
                  inspection at every width rather than by picking the
                  breakpoint that sounded right. */}
              <tr className="border-b border-rule text-left text-[10px] tracking-wide text-muted">
                <th className="w-28 px-4 py-2 font-medium">Ref</th>
                <th className="px-4 py-2 font-medium">Title</th>
                <th className="w-44 px-4 py-2 font-medium max-xl:hidden">Maker</th>
                <th className="w-52 px-4 py-2 font-medium max-xl:w-40">Estimate</th>
                <th className="w-20 px-4 py-2 text-right font-medium max-xl:hidden">
                  Photos
                </th>
              </tr>
            </thead>
            <tbody>
              {lots.map((lot) => (
                <tr
                  key={lot.id}
                  className="border-b border-rule last:border-b-0 hover:bg-sunk"
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
                  <td className="max-w-0 truncate px-4 py-2 text-muted max-xl:hidden">
                    {asText(lot.fields.maker) || "—"}
                  </td>
                  <td className="max-w-0 truncate px-4 py-2 text-muted">
                    {asText(lot.fields.price) || "—"}
                  </td>
                  <td className="px-4 py-2 text-right max-xl:hidden" data-numeric>
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
