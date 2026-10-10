import { publicHtml } from "@/lib/publication-html";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ publicationId: string }> }) {
  return publicHtml(request, (await context.params).publicationId, false);
}
