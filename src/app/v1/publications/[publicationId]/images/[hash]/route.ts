import { getAssetStore, isHash } from "@/lib/assets/store";
import { readPublication } from "@/lib/data/publications";
import { PUBLIC_HEADERS, PublicationError, publicationFailure, publicationQuery } from "@/lib/publication";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ publicationId: string; hash: string }> }) {
  try {
    const { publicationId, hash } = await context.params;
    if (!isHash(hash)) throw new PublicationError(404, "not_found", "Image not found.");
    const query = publicationQuery(new URL(request.url));
    const { snapshot } = await readPublication(publicationId, query.revision);
    const image = snapshot.images.find(value => value.hash === hash);
    if (!image) throw new PublicationError(404, "not_found", "Image not approved.");
    const bytes = await getAssetStore().get(hash);
    if (!bytes) throw new PublicationError(410, "unavailable", "Image unavailable.");
    return new Response(new Uint8Array(bytes), { headers: { ...PUBLIC_HEADERS, "Content-Type": image.mimeType,
      "Content-Length": String(bytes.byteLength), "Content-Disposition": "inline" } });
  } catch (error) { return publicationFailure(error); }
}
