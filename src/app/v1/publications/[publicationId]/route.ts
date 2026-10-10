import { readPublication } from "@/lib/data/publications";
import { PUBLIC_HEADERS, publicationFailure, publicationQuery, PublicationError } from "@/lib/publication";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ publicationId: string }> }) {
  try {
    const { publicationId } = await context.params;
    const query = publicationQuery(new URL(request.url));
    const { listing, origins } = await readPublication(publicationId, query.revision);
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin && !origins.includes(origin)) throw new PublicationError(403, "origin_denied", "Website origin is not registered.");
    return Response.json(listing, { headers: { ...PUBLIC_HEADERS, Vary: "Origin", ...(origin && origins.includes(origin) ? { "Access-Control-Allow-Origin": origin } : {}) } });
  } catch (error) { return publicationFailure(error); }
}
