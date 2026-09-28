import Link from "next/link";
import { notFound } from "next/navigation";

import { LotsIndex } from "@/components/lots-index";
import { NextAction } from "@/components/stage";
import { StageControl } from "@/components/stage-control";
import { moveLotsAction } from "./actions";
import { getCatalogue } from "@/lib/data/catalogues";
import { placesInUse } from "@/lib/data/movements";
import { factsOf, getEventSummary } from "@/lib/data/events";
import { listLotsWithImages } from "@/lib/data/lots";
import { currentOrgId, fieldPolicyOf } from "@/lib/data/org";
import { listOverrides } from "@/lib/data/overrides";
import { workflowOf } from "@/lib/data/workflow";
import { asText, derive, normaliseParams } from "@/lib/engine/derive";
import { BUILT_IN_TEMPLATES } from "@/lib/engine/templates";
import { readLots, readQuery, type LotRow } from "@/lib/lots-view";
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
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.ReactElement> {
  const { id } = await params;
  const query = readQuery(await searchParams);
  const orgId = await currentOrgId();
  // The SAME counts the ledger shows, from the same SQL, so the stage here and
  // the stage there cannot disagree about one sale.
  const [event, lots, workflow, catalogue, policy, places] = await Promise.all([
    getEventSummary(orgId, id),
    listLotsWithImages(orgId, id),
    workflowOf(orgId),
    // READ, NEVER ENSURED. Opening the sale's index is not a layout decision,
    // and the four gestures that make a catalogue row are all elsewhere —
    // src/app/events/[id]/catalogue/page.tsx carries the whole argument, which
    // this screen has to honour too or the same defect comes back by a
    // different door.
    getCatalogue(orgId, id),
    fieldPolicyOf(orgId),
    // The house's own places, so a crate keeps one spelling across sales.
    placesInUse(orgId),
  ]);
  if (!event) notFound();

  const reading = readStage(workflow, factsOf(event), event.stageOverride);

  // ── WHAT THIS CATALOGUE SAYS ABOUT EACH LOT ───────────────────────────────
  //
  // Two more whole-sale reads, and no more: the overrides in one query, and the
  // page each lot lands on from ONE derivation of the document. The page number
  // is the engine's own answer rather than this screen's arithmetic — the
  // editor's lots panel shows the same number from the same call, and a second
  // way of working it out is how two screens come to disagree about one sale.
  const overrides = catalogue ? await listOverrides(orgId, catalogue.id) : [];
  const pageOf = new Map<string, number>();
  if (lots.length > 0) {
    const params = normaliseParams(catalogue?.params);
    const document = derive(lots, params, [], overrides, BUILT_IN_TEMPLATES, policy);
    for (const page of document.pages) {
      for (const slot of page.slots) pageOf.set(slot.lotId, page.number);
    }
  }
  const overridesOf = new Map<string, number>();
  for (const o of overrides) overridesOf.set(o.lotId, (overridesOf.get(o.lotId) ?? 0) + 1);

  const rows: LotRow[] = lots.map((lot) => ({
    id: lot.id,
    ref: lot.ref,
    title: asText(lot.fields.title),
    maker: asText(lot.fields.maker),
    estimate: asText(lot.fields.price),
    photographs: lot.images.length,
    page: pageOf.get(lot.id) ?? null,
    overrides: overridesOf.get(lot.id) ?? 0,
  }));
  const view = readLots(event.id, rows, query);

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
        <LotsIndex
          eventId={event.id}
          view={view}
          places={places.map((p) => p.place)}
          // BOUND HERE, so the table never names a sale. The action checks
          // every id against the org and the event again regardless — a bound
          // argument is a convenience, not an authorisation.
          move={moveLotsAction.bind(null, event.id)}
        />
      )}
    </div>
  );
}
