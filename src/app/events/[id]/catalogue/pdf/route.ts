// The printed catalogue.
//
// Same event, same parameters, same engine, same renderer as the preview — the
// only difference is that the plates travel inside the document instead of being
// fetched from it. See src/lib/render/pdf.ts for why that is a leaf and not a
// second implementation.

import { notFound } from "next/navigation";

import { getAssetStore } from "@/lib/assets/store";
import { ensureCatalogue, listPins } from "@/lib/data/catalogues";
import { getEvent } from "@/lib/data/events";
import { listLotsWithImages } from "@/lib/data/lots";
import { currentOrgId } from "@/lib/data/org";
import { derive, normaliseParams } from "@/lib/engine/derive";
import { renderCatalogue } from "@/lib/render/html";
import { NoBrowserError, renderPdf } from "@/lib/render/pdf";
import { assets, getDb } from "@/db";
import { and, eq, inArray } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A hundred plates through a headless browser is not a five-second request.
export const maxDuration = 300;

/**
 * How many bytes of photography one export may carry.
 *
 * Inlining is what lets the document print without an origin or a session, and
 * it is also the one thing here that can exhaust a machine: base64 costs a third
 * again on top of the original, and it all exists at once as a single string. A
 * sale of five hundred 8MB scans would be four gigabytes. Past this ceiling the
 * remaining plates are dropped and SAID SO in a header rather than the export
 * dying halfway with an out-of-memory kill nobody can read.
 */
const MAX_INLINE_BYTES = 150 * 1024 * 1024;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const orgId = await currentOrgId();
  const event = await getEvent(orgId, id);
  if (!event) notFound();

  const catalogue = await ensureCatalogue(orgId, id, `${event.name} catalogue`);
  const [lots, pins] = await Promise.all([
    listLotsWithImages(orgId, id),
    listPins(orgId, catalogue.id),
  ]);

  const document = derive(lots, normaliseParams(catalogue.params), pins);

  // ── The plates, read once and carried inline ──────────────────────────────
  const wanted = [
    ...new Set(
      document.pages.flatMap((page) =>
        page.slots.map((slot) => slot.image).filter((h): h is string => !!h),
      ),
    ),
  ];

  // Mime types come from the ROWS, scoped to the org — the store holds bytes
  // addressed by content and knows nothing about what an org called them.
  const rows =
    wanted.length === 0
      ? []
      : await getDb()
          .select({ hash: assets.contentHash, mimeType: assets.mimeType })
          .from(assets)
          .where(and(eq(assets.orgId, orgId), inArray(assets.contentHash, wanted)));
  const mimeOf = new Map(rows.map((r) => [r.hash, r.mimeType]));

  const store = getAssetStore();
  const inline = new Map<string, string>();
  let carried = 0;
  let dropped = 0;
  for (const hash of wanted) {
    if (carried >= MAX_INLINE_BYTES) {
      dropped += 1;
      continue;
    }
    const bytes = await store.get(hash);
    // A row whose bytes are missing is a real condition — the migration is the
    // likeliest cause — and it prints as "no photograph" rather than failing the
    // whole export for one plate.
    if (!bytes) {
      dropped += 1;
      continue;
    }
    carried += bytes.byteLength;
    const mime = mimeOf.get(hash) ?? "image/jpeg";
    inline.set(hash, `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`);
  }

  // Anything that could not be carried loses its plate rather than its lot.
  for (const page of document.pages) {
    for (const slot of page.slots) {
      if (slot.image && !inline.has(slot.image)) slot.image = null;
    }
  }

  const html = renderCatalogue(document, {
    asset: (hash) => inline.get(hash) ?? "",
  });

  try {
    const { bytes, rendersCjk, fonts } = await renderPdf(html);

    const filename = `${event.name.replace(/[^\p{L}\p{N} ._-]/gu, "")}.pdf`.trim();
    return new Response(new Uint8Array(bytes), {
      headers: {
        "content-type": "application/pdf",
        "content-length": String(bytes.byteLength),
        // Both forms: the plain one for anything that cannot read the encoded
        // one, and the encoded one because these names are Chinese.
        "content-disposition": `attachment; filename="catalogue.pdf"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "cache-control": "no-store",
        "x-taptap3d-pages": String(document.pages.length),
        "x-taptap3d-lots": String(document.lotCount),
        "x-taptap3d-plates": String(inline.size),
        "x-taptap3d-plates-dropped": String(dropped),
        // THE FONT ANSWER TRAVELS WITH THE FILE. A PDF of tofu boxes is
        // produced successfully and discovered at the printer's, so whether a
        // Chinese glyph actually painted is stated here rather than left to be
        // noticed.
        "x-taptap3d-cjk": rendersCjk ? "rendered" : "TOFU",
        "x-taptap3d-fonts": fonts.join(", ") || "(system fallback)",
      },
    });
  } catch (error) {
    if (error instanceof NoBrowserError) {
      return Response.json(
        {
          error: error.message,
          hint: "The preview above is the same document and needs no browser.",
        },
        { status: 503 },
      );
    }
    return Response.json(
      {
        error:
          error instanceof Error
            ? `The catalogue could not be printed — ${error.message}`
            : "The catalogue could not be printed.",
      },
      { status: 500 },
    );
  }
}
