// Serve a photograph.
//
// THE HASH IS RESOLVED THROUGH THE `assets` TABLE, SCOPED TO THE ACTING ORG, and
// only then handed to the store. The store itself does not authorise — it
// returns bytes to anyone who can name a hash — so a route that passed the URL's
// hash straight to `get()` would let any caller read any blob in the system by
// guessing one. The predecessor shared its store globally by hash and then had
// to reason, repeatedly, about what that leaked.
//
// The lookup also supplies the mime type, which the store does not hold: the
// bytes are addressed by their content, and the content of a JPEG does not say
// what an org called it.

import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { assets, getDb } from "@/db";
import { getAssetStore, isHash } from "@/lib/assets/store";
import { currentOrgId } from "@/lib/data/org";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ hash: string }> },
): Promise<NextResponse | Response> {
  const { hash } = await params;
  if (!isHash(hash)) {
    return NextResponse.json({ error: "Not a content hash." }, { status: 400 });
  }

  const orgId = await currentOrgId();
  const [row] = await getDb()
    .select({ mimeType: assets.mimeType })
    .from(assets)
    .where(and(eq(assets.orgId, orgId), eq(assets.contentHash, hash)))
    .limit(1);

  // 404 rather than 403 for an asset belonging to another org: "it exists but is
  // not yours" is itself information about another tenant's holdings.
  if (!row) {
    return NextResponse.json({ error: "No such asset." }, { status: 404 });
  }

  const bytes = await getAssetStore().get(hash);
  if (!bytes) {
    // The row exists and the blob does not. Said plainly rather than as a 404,
    // because these are different faults with different fixes and the migration
    // is the thing most likely to produce this one.
    return NextResponse.json(
      { error: "The asset row exists but its bytes are missing from the store." },
      { status: 410 },
    );
  }

  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": row.mimeType,
      "content-length": String(bytes.byteLength),
      // Content-addressed, so the bytes at this URL can never change. A year is
      // the conventional ceiling, and `immutable` stops revalidation entirely.
      "cache-control": "private, max-age=31536000, immutable",
      "content-disposition": "inline",
      // The bytes are a customer's photograph; nothing should sniff them into
      // something executable.
      "x-content-type-options": "nosniff",
    },
  });
}
