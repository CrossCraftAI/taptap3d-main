// Attaching photographs to a lot, and taking them off again.
//
// Separate from the upload on purpose. The photographs arrive first and are
// assigned later — often days later, with the objects in front of the person
// doing it — so "which lot is this" is its own action with its own endpoint, not
// a required field on the way in.
//
// Both ids arrive from the request, so both are checked against the acting org
// inside the data layer before anything is written. An id is not an
// authorisation; the predecessor's entire API addressed rows by id alone.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import {
  attachAssets,
  detachAsset,
  setPrimaryAsset,
} from "@/lib/data/assets";
import { currentOrgId } from "@/lib/data/org";

export const runtime = "nodejs";

const attachSchema = z.object({
  assetIds: z.array(z.uuid()).min(1).max(500),
});

const mutateSchema = z.object({
  assetId: z.uuid(),
  action: z.enum(["detach", "primary"]),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const orgId = await currentOrgId();

  const parsed = attachSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Nothing identifiable to attach." },
      { status: 400 },
    );
  }

  const attached = await attachAssets(orgId, id, parsed.data.assetIds);
  return NextResponse.json({
    attached,
    // Said out loud rather than reported as a failure: attaching a photograph
    // that is already on the lot is a person clicking twice, not an error.
    alreadyThere: parsed.data.assetIds.length - attached,
  });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const orgId = await currentOrgId();

  const parsed = mutateSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  }

  const done =
    parsed.data.action === "detach"
      ? await detachAsset(orgId, id, parsed.data.assetId)
      : await setPrimaryAsset(orgId, id, parsed.data.assetId);

  if (!done) {
    return NextResponse.json(
      { error: "That photograph is not on this lot." },
      { status: 404 },
    );
  }
  return NextResponse.json({ ok: true });
}
