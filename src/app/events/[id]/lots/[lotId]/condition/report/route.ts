// The condition report, printed.
//
// ── ONE RENDERER BEHIND EVERY OUTPUT, INCLUDING THIS ONE ────────────────────
//
// ARCHITECTURE.md principle 6. This route paints nothing: it composes a record
// (src/lib/data/examinations.ts, `conditionReportLot`), derives a document with
// the same engine every catalogue uses, and hands it to `renderCatalogue`. The
// only thing that is new is a TEMPLATE — a declaration, validated at module
// load — and the library it is looked up in.
//
// A screen that printed itself would be a second renderer by another name, and
// the predecessor's preview stopped resembling its deliverable exactly that
// way.
//
// ── HTML AND NOT A PDF, AND THAT IS NOT A SHORTFALL ─────────────────────────
//
// The document carries `@page { size: A4 }` and prints from a browser. The PDF
// route for the catalogue is the same function with a different asset resolver
// and a headless Chromium, and it answers 503 wherever one is not installed
// (src/app/events/[id]/catalogue/pdf/route.ts). A second 503 on a screen a
// registrar reaches from a warehouse tablet would be a button that does
// nothing most of the time, so this is the document itself. The day the report
// needs a byte-identical PDF it is the same three lines the catalogue's route
// already has.
//
// ── THE CSP, AND WHY IT IS ON THIS TOO ──────────────────────────────────────
//
// The same header and the same first tag as the preview: `default-src 'none'`
// with no `script-src`, because this document renders untrusted client data —
// an examiner's prose, a house's own column names. It is not displayed in a
// frame anybody edits, so nothing here depends on principle 8's sandbox
// argument; it is inert because the policy says so.

import { notFound } from "next/navigation";

import {
  conditionReportLot,
  lifetimeOf,
  listExaminations,
} from "@/lib/data/examinations";
import { getEvent } from "@/lib/data/events";
import { getLot } from "@/lib/data/lots";
import { formatDay, listMovements, provenanceText } from "@/lib/data/movements";
import { currentOrgId } from "@/lib/data/org";
import { derive, DEFAULT_PARAMS } from "@/lib/engine/derive";
import { CONDITION_REPORT, REPORT_TEMPLATES } from "@/lib/engine/templates";
import { PREVIEW_CSP, renderCatalogue } from "@/lib/render/html";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; lotId: string }> },
): Promise<Response> {
  const { id, lotId } = await params;
  const orgId = await currentOrgId();
  const [event, lot] = await Promise.all([getEvent(orgId, id), getLot(orgId, lotId)]);
  if (!event || !lot || lot.eventId !== event.id) notFound();

  const [history, chain] = await Promise.all([
    listExaminations(orgId, lot.id),
    listMovements(orgId, lot.id),
  ]);
  const current = history[history.length - 1];
  // NO EXAMINATION, NO REPORT. A blank sheet with a lot number on it looks
  // like a report that found nothing, which is the one thing a condition
  // document must never be mistaken for.
  if (!current) notFound();

  const wantsLifetime = new URL(request.url).searchParams.get("of") === "lifetime";
  const leg = current.movementId
    ? chain.find((entry) => entry.id === current.movementId)
    : undefined;

  const record = conditionReportLot({
    lot: { id: lot.id, ref: lot.ref, fields: lot.fields ?? {} },
    examination: current,
    occasion: leg
      ? `${leg.fromPlace ?? "outside the house"} → ${leg.toPlace}, ${formatDay(leg.occurredAt)}`
      : null,
    // The one place in this phase where the print path reads the movement
    // table, and it reads it through the same function the movement screen
    // shows on the page (`provenanceOf`), so the two cannot drift.
    provenance: provenanceText(chain) || null,
    ...(wantsLifetime ? { lifetime: lifetimeOf(history) } : {}),
  });

  const document = derive(
    [record],
    { ...DEFAULT_PARAMS, template: CONDITION_REPORT.id, perPage: 1 },
    [],
    [],
    // The library is the argument the engine already takes for exactly this.
    // `BUILT_IN_TEMPLATES` is what a CATALOGUE may be laid out on, and a
    // condition report is not one — src/lib/engine/templates.ts says why.
    REPORT_TEMPLATES,
  );

  return new Response(renderCatalogue(document), {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": PREVIEW_CSP,
      "cache-control": "no-store",
    },
  });
}
