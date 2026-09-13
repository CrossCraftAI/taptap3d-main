// The preview document.
//
// A ROUTE, NOT A `srcdoc`. The frame must be same-origin for `img-src 'self'` to
// permit `/api/assets/…`, and a srcdoc frame's origin is opaque in some engines —
// which would leave every plate blocked with no error a person could see.
//
// The Content-Security-Policy is sent as a HEADER as well as carried as the
// first tag in the document's <head>. Either alone is sufficient; both together
// mean the guarantee does not depend on which one a given engine honours first,
// and the header cannot be lost by a downstream transformation of the HTML.
//
// The frame that displays this carries NO `sandbox` attribute. See
// ARCHITECTURE.md principle 8 — a sandbox without `allow-scripts` stops WebKit
// dispatching DOM events into the frame at all, which killed the predecessor's
// entire editing layer in Safari while Chromium-only testing stayed green.

import { notFound } from "next/navigation";

import { ensureCatalogue, listPins } from "@/lib/data/catalogues";
import { getEvent } from "@/lib/data/events";
import { listLotsWithImages } from "@/lib/data/lots";
import { currentOrgId } from "@/lib/data/org";
import { derive, normaliseParams } from "@/lib/engine/derive";
import { PREVIEW_CSP, renderCatalogue } from "@/lib/render/html";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

  return new Response(renderCatalogue(document), {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": PREVIEW_CSP,
      "cache-control": "no-store",
    },
  });
}
