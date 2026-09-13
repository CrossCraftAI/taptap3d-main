// Take photographs in.
//
// MANY FILES, ONE REQUEST, AND NO LOT REQUIRED. Dropping a folder onto the page
// is the gesture this exists to serve, and a photographer's folder is four
// hundred files that nobody has yet worked out the lot numbers for. `lotId` is
// optional; without it the photographs land in the library unassigned, which is
// a normal state (src/lib/data/assets.ts).
//
// EVERY FILE GETS ITS OWN VERDICT. A batch that refuses wholesale because file
// 303 is a .DS_Store is a batch the specialist has to bisect by hand, mid-shoot.
// The response is one result per file, and the screen shows what landed and what
// did not.

import { NextResponse, type NextRequest } from "next/server";

import { getAssetStore } from "@/lib/assets/store";
import { measureImage, sniffMime } from "@/lib/assets/measure";
import { attachAssets, recordAsset } from "@/lib/data/assets";
import { currentOrgId } from "@/lib/data/org";

export const runtime = "nodejs";

/** 80 MB a file. A repro-house TIFF of a scroll painting is genuinely this big. */
const MAX_BYTES = 80 * 1024 * 1024;

export interface UploadResult {
  filename: string;
  ok: boolean;
  /** Present when ok. */
  assetId?: string;
  contentHash?: string;
  width?: number;
  height?: number;
  /** True when these exact bytes were already held. Not a failure. */
  duplicate?: boolean;
  /** Present when not ok, and written for a person rather than a log. */
  reason?: string;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const orgId = await currentOrgId();

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "That upload could not be read. Try fewer files at once." },
      { status: 400 },
    );
  }

  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  const lotId = form.get("lotId");
  if (files.length === 0) {
    return NextResponse.json({ error: "No files arrived." }, { status: 400 });
  }

  const store = getAssetStore();
  const results: UploadResult[] = [];
  const attached: string[] = [];

  for (const file of files) {
    // A folder drop brings the operating system's own bookkeeping with it.
    // Refusing these loudly would be noise; they are skipped by name.
    if (/^(\.DS_Store|Thumbs\.db|desktop\.ini)$/i.test(file.name)) continue;

    if (file.size === 0) {
      results.push({ filename: file.name, ok: false, reason: "The file is empty." });
      continue;
    }
    if (file.size > MAX_BYTES) {
      results.push({
        filename: file.name,
        ok: false,
        reason: `${Math.round(file.size / 1024 / 1024)} MB is over the 80 MB limit.`,
      });
      continue;
    }

    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const measured = measureImage(bytes);
      // A file that measures as nothing is not refused. It is stored, and the
      // library shows it as unmeasured — a format nobody anticipated is still a
      // file the specialist meant to keep, and refusing it mid-shoot teaches
      // them to stop using the system.
      const mime = sniffMime(bytes, file.type || "application/octet-stream");

      const stored = await store.put(bytes);
      const { id, created } = await recordAsset(orgId, {
        contentHash: stored.hash,
        mimeType: mime,
        byteSize: stored.size,
        originalName: file.name,
        geometry: measured
          ? { width: measured.width, height: measured.height, format: measured.format }
          : null,
      });

      if (typeof lotId === "string" && lotId) attached.push(id);
      results.push({
        filename: file.name,
        ok: true,
        assetId: id,
        contentHash: stored.hash,
        ...(measured ? { width: measured.width, height: measured.height } : {}),
        duplicate: !created,
      });
    } catch (error) {
      results.push({
        filename: file.name,
        ok: false,
        reason:
          error instanceof Error
            ? `Could not be stored — ${error.message}`
            : "Could not be stored.",
      });
    }
  }

  // Attached in ONE call after the loop, so the first photograph of a batch
  // becomes the plate and the rest queue behind it in order — rather than each
  // file racing to claim primary.
  let attachedCount = 0;
  if (typeof lotId === "string" && lotId && attached.length > 0) {
    attachedCount = await attachAssets(orgId, lotId, attached);
  }

  return NextResponse.json({
    results,
    stored: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    attached: attachedCount,
  });
}
