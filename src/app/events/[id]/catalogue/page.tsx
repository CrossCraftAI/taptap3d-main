import Link from "next/link";
import { notFound } from "next/navigation";

import { CatalogueControls } from "@/components/catalogue-controls";
import { CatalogueWorkspace } from "@/components/catalogue-workspace";
import { PinPanel, type PinPanelLot, type PinPanelPin } from "@/components/pin-panel";
import { PreviewCanvas } from "@/components/preview-canvas";
import { getCatalogue, listPins } from "@/lib/data/catalogues";
import { getEvent } from "@/lib/data/events";
import { listLotsWithImages } from "@/lib/data/lots";
import { currentOrgId } from "@/lib/data/org";
import { listOverrides } from "@/lib/data/overrides";
import { asText, derive, normaliseParams } from "@/lib/engine/derive";
import { BUILT_IN_TEMPLATES, templateChoice } from "@/lib/engine/templates";

export const dynamic = "force-dynamic";

/**
 * The editor.
 *
 * ── A BLANK PAGE, NOT A CARD ABOUT ONE ───────────────────────────────────────
 *
 * M1.md §1 step 2: create an event → an empty editor. Quick-add lands here now,
 * and with no lots this screen used to show a centred panel saying there was
 * nothing to lay out. A new Canva design shows an artboard and a new Docs file
 * shows a page; a card is an advertisement for the thing in place of the thing.
 * So the frame always holds a page — the renderer paints a blank sheet on the
 * template's geometry when the document has none (src/lib/render/html.ts) —
 * the controls are live, and the one way to fill it sits on the canvas at the
 * foot of the sheet. That bar is not a dismissible hint: it is the action, and
 * it leaves with the first lot.
 *
 * ── THIS SCREEN WRITES NOTHING. LOOKING IS NOT LAYING OUT ────────────────────
 *
 * `ensureCatalogue` ran here, and the workflow reads a catalogue row as the
 * FACT that a sale has been catalogued (src/lib/workflow.ts). So loading this
 * page advanced the sale's stage: measured, by opening a sale that read
 * "Photographed · Open catalogue", clicking nothing, and finding it read
 * "Catalogued · Download PDF" afterwards. The ledger prints "Nobody files a
 * status, so nobody can forget to" — and looking filed one.
 *
 * An earlier version of this note saw half of it. It guarded the sale with NO
 * lots, because a brand-new sale jumping to Catalogued was the obvious case,
 * and left the write in place for every sale that had any. The half that was
 * missed is the one a specialist meets every day.
 *
 * So the row is read, never made. It is made by the first thing that is
 * actually a layout decision, and each of those already makes it:
 * `setCatalogueParamsAction` (choosing a template IS laying out) and
 * `pinTogetherAction`, both in ./actions.ts. Everything below already handles
 * a null catalogue, because it had to for the empty sale — including the lots
 * panel, whose pins are empty until there is a row to hang them on and whose
 * first pin creates it.
 *
 * Rejected: leaving the write and narrowing the FACT instead — counting only
 * catalogues that carry a decision, or whose `updated_at` has moved past their
 * `created_at`. Both make the stage a derived property of a row's history
 * rather than of its existence, which is a second rule to keep in step with
 * this one, and neither stops a GET writing.
 */
export default async function CataloguePage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.ReactElement> {
  const { id } = await params;
  const orgId = await currentOrgId();
  const event = await getEvent(orgId, id);
  if (!event) notFound();

  const lots = await listLotsWithImages(orgId, id);
  const catalogue = await getCatalogue(orgId, id);
  const [pins, overrides] = catalogue
    ? await Promise.all([listPins(orgId, catalogue.id), listOverrides(orgId, catalogue.id)])
    : [[], []];

  const layoutParams = normaliseParams(catalogue?.params);
  // Zero for a sale with no catalogue row yet: nothing about it can have changed.
  const version = catalogue?.updatedAt.getTime() ?? 0;
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
    version,
  ].join("-");
  // Derived here only to say how many pages it came to, and which page each lot
  // landed on for the list beside the preview. The frame derives it again from
  // the same inputs — one engine, so the two cannot disagree.
  const document = derive(lots, layoutParams, pins, overrides);
  const empty = lots.length === 0;

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
    <CatalogueWorkspace
      catalogueId={catalogue?.id ?? null}
      heading={
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[13px]">
          <Link
            href={`/events/${event.id}`}
            className="max-w-[20rem] truncate text-muted hover:text-seal hover:underline"
          >
            {event.name}
          </Link>
          <span className="text-faint">/</span>
          <h1 className="font-semibold tracking-tight">Catalogue</h1>
        </div>
      }
      meta={
        <p className="text-[12px] text-muted" data-numeric>
          <span className="text-ink">{document.template.name.en}</span>
            {empty ? (
              " · no lots yet"
            ) : (
              <>
                {" · "}
                {document.pages.length} pages · {document.lotCount} lots
                {document.unphotographed > 0 && (
                  <span className="text-seal">
                    {" · "}
                    {document.unphotographed} without a photograph
                  </span>
                )}
                {pins.length > 0 && (
                  <>
                    {" · "}
                    {pins.length} {pins.length === 1 ? "pin" : "pins"}
                  </>
                )}
                {overrides.length > 0 && (
                  <>
                    {" · "}
                    {overrides.length} {overrides.length === 1 ? "override" : "overrides"}
                  </>
                )}
              </>
            )}
        </p>
      }
      // Nothing prints from a blank page: the exports ledger offers no PDF for a
      // sale without lots, and neither does its editor.
      actions={
        empty ? undefined : (
          <a
            href={`/events/${event.id}/catalogue/pdf`}
            title="The PDF is this same document, printed. It takes a moment on a long sale."
            className="bg-seal px-3 py-1 text-[12px] font-medium text-white hover:bg-sealPress"
          >
            Download PDF
          </a>
        )
      }
      controls={
        /* KEYED ON THE STORED PARAMETERS. The controls hold local state so they
           respond in the same frame the pointer moves; this is what hands
           authority back to the server once the action lands, by making the
           component new rather than by syncing a prop into state. */
        <CatalogueControls
          key={previewKey}
          eventId={event.id}
          catalogueId={catalogue?.id ?? null}
          params={layoutParams}
          // The built-ins, reduced to what a control needs. A house-authored
          // template joins this list from the data layer the day one exists.
          templates={BUILT_IN_TEMPLATES.map(templateChoice)}
        />
      }
      canvas={
        <>
          {/* NOT KEYED, deliberately. Everything else on this screen is keyed
              on the stored parameters so the server takes authority back by
              remounting the control; the canvas is the one thing that must
              NOT be remounted, because a remount throws away both frames and
              with them the scroll position the second frame exists to keep.
              It takes the version as a prop and swaps buffers itself. */}
          <PreviewCanvas
            eventId={event.id}
            catalogueId={catalogue?.id ?? null}
            // THE PARAMETERS ARE IN THE URL, and not because the route reads
            // them — it reads the catalogue row, which is the source of truth.
            // They are here because a frame reloads when its `src` changes and
            // at no other time: re-rendering the page around an unchanged `src`
            // leaves the previous document sitting in the frame, so changing the
            // density appeared to do nothing at all. Found by driving the
            // application; no unit test could have seen it.
            src={`/events/${event.id}/catalogue/preview?v=${previewKey}`}
          />
          {empty && (
            /* ON THE CANVAS, at the foot of the blank sheet: one line and the one
               action, the way a new document says where to start. The container
               lets the pointer through to the frame everywhere but the bar. */
            <div className="pointer-events-none absolute inset-x-0 bottom-6 flex justify-center">
              <div className="pointer-events-auto flex items-center gap-4 border border-rule bg-paper py-2 pl-4 pr-2 shadow-[0_1px_2px_rgba(0,0,0,.08),0_6px_20px_rgba(0,0,0,.06)]">
                <p className="text-[13px] text-muted">
                  No lots yet. Import them and the engine lays out the pages.
                </p>
                <Link
                  href={`/events/${event.id}/import`}
                  className="bg-seal px-3 py-1.5 text-[13px] font-medium text-white hover:bg-sealPress"
                >
                  Import lots
                </Link>
              </div>
            </div>
          )}
        </>
      }
      panel={
        !empty ? (
          /* Keyed on the catalogue's version: a pin that lands gives a fresh
             panel, a refusal — which changes nothing — keeps its message.

             NOT GATED ON THE CATALOGUE ROW any more. The row no longer exists
             merely because someone opened this screen, so gating the panel on
             it would hide the pin control until a template had been chosen —
             and pinning is itself a layout decision, so it is one of the two
             gestures that CREATES the row (pinTogetherAction ensures it). The
             id is only carried here so a gesture can be counted against the
             right catalogue; null until the first one, which is honest. */
          <PinPanel
            key={version}
            eventId={event.id}
            catalogueId={catalogue?.id ?? null}
            lots={panelLots}
            pins={panelPins}
          />
        ) : null
      }
    />
  );
}
