import Link from "next/link";
import { notFound } from "next/navigation";

import { CatalogueControls } from "@/components/catalogue-controls";
import { PinPanel, type PinPanelLot, type PinPanelPin } from "@/components/pin-panel";
import { ensureCatalogue, listPins } from "@/lib/data/catalogues";
import { getEvent } from "@/lib/data/events";
import { listLotsWithImages } from "@/lib/data/lots";
import { currentOrgId } from "@/lib/data/org";
import { listOverrides } from "@/lib/data/overrides";
import { asText, derive, normaliseParams } from "@/lib/engine/derive";
import { BUILT_IN_TEMPLATES, templateChoice } from "@/lib/engine/templates";

export const dynamic = "force-dynamic";

export default async function CataloguePage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.ReactElement> {
  const { id } = await params;
  const orgId = await currentOrgId();
  const event = await getEvent(orgId, id);
  if (!event) notFound();

  const catalogue = await ensureCatalogue(orgId, id, `${event.name} catalogue`);
  const [lots, pins, overrides] = await Promise.all([
    listLotsWithImages(orgId, id),
    listPins(orgId, catalogue.id),
    listOverrides(orgId, catalogue.id),
  ]);

  const layoutParams = normaliseParams(catalogue.params);
  const previewKey = [
    // The template first: a price list and a catalogue at the same density
    // are different documents.
    layoutParams.template,
    layoutParams.perPage,
    layoutParams.imagePlacement,
    layoutParams.showRef ? "ref" : "noref",
    layoutParams.fit,
    // The lots too: an import that adds rows must move the preview, and the
    // parameters alone would not have changed. And the newest EDIT to a lot,
    // because a corrected title changes the document without changing the
    // count.
    lots.length,
    Math.max(0, ...lots.map((l) => l.updatedAt.getTime())),
    // Pins and overrides touch the catalogue row when they change, so this one
    // number carries all of them.
    catalogue.updatedAt.getTime(),
  ].join("-");
  // Derived here only to say how many pages it came to, and which page each lot
  // landed on for the list beside the preview. The frame derives it again from
  // the same inputs — one engine, so the two cannot disagree.
  const document = derive(lots, layoutParams, pins, overrides);

  const pageOf = new Map<string, number>();
  for (const page of document.pages) {
    for (const slot of page.slots) pageOf.set(slot.lotId, page.number);
  }
  const overridesOf = new Map<string, number>();
  for (const o of overrides) overridesOf.set(o.lotId, (overridesOf.get(o.lotId) ?? 0) + 1);
  const pinnedLots = new Set(pins.flatMap((p) => p.lotIds));
  const refOf = new Map(
    lots.map((l) => [l.id, l.ref ?? (asText(l.fields.title) || "untitled")]),
  );

  const panelLots: PinPanelLot[] = lots.map((lot) => ({
    id: lot.id,
    ref: lot.ref,
    title: asText(lot.fields.title),
    page: pageOf.get(lot.id) ?? null,
    overrides: overridesOf.get(lot.id) ?? 0,
    pinned: pinnedLots.has(lot.id),
  }));
  const panelPins: PinPanelPin[] = pins.map((pin) => ({
    id: pin.id,
    refs: pin.lotIds.map((lotId) => refOf.get(lotId) ?? "?"),
  }));

  return (
    <div className="flex h-screen min-h-0 flex-col">
      <header className="shrink-0 border-b border-rule bg-paper px-8 py-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <Link
              href={`/events/${event.id}`}
              className="text-[12px] text-muted hover:text-seal hover:underline"
            >
              {event.name}
            </Link>
            <h1 className="mt-1 text-[19px] font-semibold tracking-tight">
              Catalogue
            </h1>
          </div>
          <div className="flex items-center gap-4">
            <a
              href={`/events/${event.id}/catalogue/pdf`}
              className="bg-seal px-3 py-1.5 text-[13px] font-medium text-white hover:bg-[#8d241f]"
            >
              Download PDF
            </a>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-[12px] text-muted" data-numeric>
            <span className="text-ink">{document.template.name.en}</span> ·{" "}
            {document.pages.length} pages · {document.lotCount} lots
            {document.unphotographed > 0 && (
              <span className="text-seal">
                {" "}
                · {document.unphotographed} without a photograph
              </span>
            )}
            {pins.length > 0 && (
              <>
                {" "}
                · {pins.length} {pins.length === 1 ? "pin" : "pins"}
              </>
            )}
            {overrides.length > 0 && (
              <>
                {" "}
                · {overrides.length} {overrides.length === 1 ? "override" : "overrides"}
              </>
            )}
          </p>
          <p className="text-[12px] text-faint">
            The PDF is this same document, printed. It takes a moment on a long
            sale.
          </p>
        </div>
      </header>

      <div className="shrink-0 px-8 pt-4">
        {/* KEYED ON THE STORED PARAMETERS. The controls hold local state so
            they respond in the same frame the pointer moves; this is what hands
            authority back to the server once the action lands, by making the
            component new rather than by syncing a prop into state. */}
        <CatalogueControls
          key={previewKey}
          eventId={event.id}
          catalogueId={catalogue.id}
          params={layoutParams}
          // The built-ins, reduced to what a control needs. A house-authored
          // template joins this list from the data layer the day one exists.
          templates={BUILT_IN_TEMPLATES.map(templateChoice)}
        />
      </div>

      <div className="min-h-0 flex-1 px-8 pb-8 pt-4">
        {lots.length === 0 ? (
          <div className="flex h-full items-center justify-center border border-rule bg-paper">
            <div className="max-w-sm text-center">
              <p className="text-[14px] font-medium">Nothing to lay out yet.</p>
              <p className="mt-2 text-[13px] leading-relaxed text-muted">
                The engine places every lot for you; it needs the lots first.
              </p>
              <Link
                href={`/events/${event.id}/import`}
                className="mt-5 inline-block bg-seal px-4 py-2 text-[13px] font-medium text-white hover:bg-[#8d241f]"
              >
                Import lots
              </Link>
            </div>
          </div>
        ) : (
          <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)_340px] gap-4">
            {/* NO `sandbox` ATTRIBUTE. The document is inert because of its
                Content-Security-Policy, which carries no script-src. A sandbox
                without allow-scripts stops WebKit dispatching DOM events into the
                frame at all — ARCHITECTURE.md principle 8, and the reason the
                predecessor's editing layer was dead in Safari for a year while
                Chromium-only testing reported everything green. */}
            <iframe
              title="Catalogue preview"
              // THE PARAMETERS ARE IN THE URL, and not because the route reads
              // them — it reads the catalogue row, which is the source of truth.
              // They are here because the frame reloads when its `src` changes and
              // at no other time: re-rendering the page around an unchanged `src`
              // leaves the previous document sitting in the frame, so changing the
              // density appeared to do nothing at all. Found by driving the
              // application; no unit test could have seen it.
              src={`/events/${event.id}/catalogue/preview?v=${previewKey}`}
              className="h-full w-full border border-rule bg-paper"
            />
            {/* Keyed on the catalogue's version: a pin that lands gives a fresh
                panel, a refusal — which changes nothing — keeps its message. */}
            <PinPanel
              key={catalogue.updatedAt.getTime()}
              eventId={event.id}
              catalogueId={catalogue.id}
              lots={panelLots}
              pins={panelPins}
            />
          </div>
        )}
      </div>
    </div>
  );
}
