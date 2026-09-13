import Link from "next/link";
import { notFound } from "next/navigation";

import { CatalogueControls } from "@/components/catalogue-controls";
import { ensureCatalogue, listPins } from "@/lib/data/catalogues";
import { getEvent } from "@/lib/data/events";
import { listLotsWithImages } from "@/lib/data/lots";
import { currentOrgId } from "@/lib/data/org";
import { derive, normaliseParams } from "@/lib/engine/derive";

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
  const [lots, pins] = await Promise.all([
    listLotsWithImages(orgId, id),
    listPins(orgId, catalogue.id),
  ]);

  const layoutParams = normaliseParams(catalogue.params);
  const previewKey = [
    layoutParams.perPage,
    layoutParams.imagePlacement,
    layoutParams.showRef ? "ref" : "noref",
    layoutParams.fit,
    // The lots too: an import that adds rows must move the preview, and the
    // parameters alone would not have changed.
    lots.length,
    catalogue.updatedAt.getTime(),
  ].join("-");
  // Derived here only to say how many pages it came to. The frame derives it
  // again from the same inputs — one engine, so the two cannot disagree.
  const document = derive(lots, layoutParams, pins);

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
          <p className="text-[12px] text-muted" data-numeric>
            {document.pages.length} pages · {document.lotCount} lots
            {document.unphotographed > 0 && (
              <span className="text-seal">
                {" "}
                · {document.unphotographed} without a photograph
              </span>
            )}
          </p>
        </div>
      </header>

      <div className="shrink-0 px-8 pt-4">
        <CatalogueControls eventId={event.id} params={layoutParams} />
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
          /* NO `sandbox` ATTRIBUTE. The document is inert because of its
             Content-Security-Policy, which carries no script-src. A sandbox
             without allow-scripts stops WebKit dispatching DOM events into the
             frame at all — ARCHITECTURE.md principle 8, and the reason the
             predecessor's editing layer was dead in Safari for a year while
             Chromium-only testing reported everything green. */
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
        )}
      </div>
    </div>
  );
}
