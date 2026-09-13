// Read whatever the client brought, and say why when it cannot.
//
// The handler is thin on purpose: `parseUpload` and `parsePastedText` never
// throw, and every failure they describe is a value with a reason and a
// suggestion. So there is no error branch here to speak of — an unreadable file
// is a 200 carrying an explanation, because it is an ANSWER, not a fault. A 4xx
// would make the browser's console the place that knows what went wrong, and the
// person who needs to know is standing in front of a customer.

import { NextResponse, type NextRequest } from "next/server";

import { getEvent } from "@/lib/data/events";
import { currentOrgId } from "@/lib/data/org";
import { parsePastedText, parseUpload } from "@/lib/import/parse";

export const runtime = "nodejs";

/** 25 MB. A lot list is a grid of text; anything larger is not one. */
const MAX_BYTES = 25 * 1024 * 1024;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const orgId = await currentOrgId();
  // The event is checked before the file is read. Parsing for an event this org
  // does not own would be work done on behalf of a caller with no right to it.
  const event = await getEvent(orgId, id);
  if (!event) {
    return NextResponse.json({ error: "No such event." }, { status: 404 });
  }

  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    const body = (await request.json()) as { text?: unknown };
    const text = typeof body.text === "string" ? body.text : "";
    if (!text.trim()) {
      return NextResponse.json({
        kind: "unreadable",
        filename: "pasted text",
        reason: "Nothing was pasted.",
        suggestion: "Copy the lot list from the spreadsheet and paste it here.",
      });
    }
    return NextResponse.json(parsePastedText(text));
  }

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({
      kind: "unreadable",
      filename: "no file",
      reason: "No file arrived with the request.",
      suggestion: "Choose a file, or paste the lot list as text instead.",
    });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({
      kind: "unreadable",
      filename: file.name,
      reason: `That file is ${Math.round(file.size / 1024 / 1024)} MB, and the limit is 25 MB.`,
      suggestion:
        "If it is a spreadsheet with images embedded, export just the lot sheet as CSV.",
    });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  return NextResponse.json(await parseUpload(bytes, file.name));
}
