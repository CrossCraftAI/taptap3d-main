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

import { getCatalogue, listPins } from "@/lib/data/catalogues";
import { getEvent } from "@/lib/data/events";
import { listLotsWithImages } from "@/lib/data/lots";
import { currentOrgId, fieldPolicyOf } from "@/lib/data/org";
import { listOverrides } from "@/lib/data/overrides";
import { derive, normaliseParams } from "@/lib/engine/derive";
import { BUILT_IN_TEMPLATES } from "@/lib/engine/templates";
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

  // READ, NEVER MADE. This is a GET, and the frame asks for it on every version
  // of the editor including the blank one; the catalogue row is the editor
  // page's to create, when there are lots to lay out (see ../page.tsx — a row
  // made here would be read by the workflow as a sale already catalogued).
  // Absent a row, the document is the defaults over no lots: one blank sheet.
  const catalogue = await getCatalogue(orgId, id);
  // Lots, pins, overrides AND the house's field policy: the same four inputs the
  // PDF route reads, so the two consumers cannot disagree about what a
  // correction did or about what may leave the building. The preview IS the
  // catalogue; a field visible here and absent from the print would make that
  // sentence false in the most expensive direction.
  const [lots, pins, overrides, policy] = await Promise.all([
    listLotsWithImages(orgId, id),
    catalogue ? listPins(orgId, catalogue.id) : [],
    catalogue ? listOverrides(orgId, catalogue.id) : [],
    fieldPolicyOf(orgId),
  ]);

  const document = derive(
    lots,
    normaliseParams(catalogue?.params),
    pins,
    overrides,
    BUILT_IN_TEMPLATES,
    policy,
  );

  return new Response(renderCatalogue(document), {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": PREVIEW_CSP,
      "cache-control": "no-store",
    },
  });
}
