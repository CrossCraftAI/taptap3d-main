import { levelOf, policyFor } from "./engine/visibility";

export class PublicationError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) { super(message); }
}
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export function publicId(id: string, prefix = "pub_"): string { return prefix + id; }
export function privateId(id: string, prefix = "pub_"): string {
  const value = id.startsWith(prefix) ? id.slice(prefix.length) : "";
  if (!UUID.test(value)) throw new PublicationError(404, prefix === "rev_" ? "revision_not_found" : "publication_not_found", "Publication not found.");
  return value;
}
export function isPublishableField(value: unknown): boolean {
  if (typeof value === "string" || typeof value === "number") return true;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entries = Object.entries(value);
  return entries.length > 0 && entries.every(([key, text]) => ["zh", "en"].includes(key) && typeof text === "string");
}
export function approvedFields(fields: Record<string, unknown>, selected: string[], policy: unknown, language = "zh-Hant"): Record<string, string> {
  if (!selected.length || selected.length > 100) throw new PublicationError(400, "invalid_selection", "Select between 1 and 100 fields.");
  const clean: Record<string, string> = Object.create(null);
  for (const key of new Set(selected)) {
    if (key.startsWith("_") || !Object.hasOwn(fields, key) || levelOf(policyFor(policy), key) !== "public")
      throw new PublicationError(400, "private_field", "A selected field cannot be published.");
    if (!isPublishableField(fields[key]))
      throw new PublicationError(400, "invalid_field", "Only text and numeric fields may be published.");
    const raw = fields[key];
    const translated = raw && typeof raw === "object" ? (raw as Record<string, string>)[language === "zh-Hant" ? "zh" : "en"] : raw;
    if (translated === undefined) throw new PublicationError(400, "invalid_field", "A selected field has no text in the chosen language.");
    const value = String(translated);
    if (value.length > 20000) throw new PublicationError(400, "invalid_field", "A field is too long.");
    clean[key] = value;
  }
  return clean;
}
export function registeredOrigins(values: string[]): string[] {
  if (values.length > 20) throw new Error("Register at most 20 website origins.");
  return [...new Set(values.filter(Boolean).map(value => {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname.includes("*") || url.username || url.password || url.pathname !== "/" || url.search || url.hash)
      throw new Error("Enter HTTPS origins only, for example https://shop.example.com.");
    return url.origin;
  }))];
}
export function publicationOrigin(): string {
  const raw = process.env.TAPTAP3D_PUBLIC_ORIGIN;
  if (!raw) throw new PublicationError(503, "service_unavailable", "Publication origin has not been configured.");
  const url = new URL(raw);
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash ||
    (url.protocol !== "https:" && !(url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname))))
    throw new PublicationError(503, "service_unavailable", "Publication origin is invalid.");
  return url.origin;
}
export function publicationQuery(url: URL, embed = false): { revision?: string; locale?: string; theme: string } {
  const permitted = new Set(["revision", "locale", ...(embed ? ["theme"] : [])]);
  for (const key of url.searchParams.keys()) {
    if (!permitted.has(key) || url.searchParams.getAll(key).length !== 1)
      throw new PublicationError(400, "invalid_request", "Unsupported or repeated parameter.");
  }
  const revision = url.searchParams.get("revision") ?? undefined;
  if (revision) privateId(revision, "rev_");
  if (revision === "") throw new PublicationError(400, "invalid_request", "Revision cannot be empty.");
  const locale = url.searchParams.get("locale") ?? undefined;
  const theme = url.searchParams.get("theme") ?? "light";
  if ((locale !== undefined && !["en", "zh-Hant"].includes(locale)) || !["light", "dark"].includes(theme))
    throw new PublicationError(400, "invalid_request", "Unsupported locale or theme.");
  return { revision, locale, theme };
}
export const PUBLIC_HEADERS = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "X-Robots-Tag": "noindex, nofollow" };
export function publicationFailure(error: unknown): Response {
  const known = error instanceof PublicationError;
  return Response.json({ error: { code: known ? error.code : "service_unavailable", message: known ? error.message : "Publication temporarily unavailable." } },
    { status: known ? error.status : 503, headers: PUBLIC_HEADERS });
}
