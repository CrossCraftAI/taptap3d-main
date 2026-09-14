// The action log's one entry point.
//
// Every gesture the client counts arrives here in a batch: a session id the
// client made up for this sitting, and a monotonic sequence within it. The
// server adds what only it knows — which org, which person as far as it can
// tell — and refuses nothing it can record. A log endpoint that answers 4xx to
// a slightly odd gesture is a log with holes exactly where the interesting
// behaviour was (ARCHITECTURE.md principle 5).
//
// It is a Route Handler and not a server action because it is not a mutation of
// anything a page shows: nothing re-renders, no cache is touched, and the client
// sends it with `keepalive` so a gesture made on the way out of a page is still
// counted.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { recordActions } from "@/lib/data/actions";
import { currentActorId } from "@/lib/data/actor";
import { currentOrgId } from "@/lib/data/org";

export const runtime = "nodejs";

const bodySchema = z.object({
  sessionId: z.uuid(),
  actions: z
    .array(
      z.object({
        seq: z.int().nonnegative(),
        // A dotted name — `lot.fields.save`, `catalogue.pin` — so D9 can count
        // by prefix without a vocabulary table nobody keeps up to date.
        action: z.string().min(1).max(120),
        payload: z.record(z.string(), z.unknown()).optional(),
        catalogueId: z.uuid().nullable().optional(),
        occurredAt: z.iso.datetime().optional(),
      }),
    )
    .min(1)
    .max(200),
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  const orgId = await currentOrgId();

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Not JSON." }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "A gesture needs a session, a sequence number and a name." },
      { status: 400 },
    );
  }

  // The gate identity, so a gesture is attributed the same way a decision is.
  const userId = await currentActorId(orgId);
  const recorded = await recordActions(
    orgId,
    parsed.data.sessionId,
    userId,
    parsed.data.actions.map((a) => ({
      seq: a.seq,
      action: a.action,
      payload: a.payload,
      catalogueId: a.catalogueId ?? null,
      occurredAt: a.occurredAt ? new Date(a.occurredAt) : undefined,
    })),
  );
  return NextResponse.json({ recorded });
}
