import { and, desc, eq, isNull } from "drizzle-orm";
import { getDb, lots, orgs, publications, publicationRevisions } from "@/db";
import { approvedFields, privateId, publicId, publicationOrigin, PublicationError, registeredOrigins } from "@/lib/publication";
import { requireAdministrator } from "./access";
import { currentActorId } from "./actor";
import { listAssetsForLot } from "./assets";

export interface Approval {
  fields: string[]; titleField: string; descriptionFields: string[];
  images: string[]; imageRights: boolean; language: "en" | "zh-Hant"; origins: string[];
}
export async function approvePublication(orgId: string, lotId: string, approval: Approval) {
  await requireAdministrator(orgId);
  publicationOrigin();
  const actorId = await currentActorId(orgId);
  const origins = registeredOrigins(approval.origins);
  if (!["en", "zh-Hant"].includes(approval.language)) throw new Error("Choose a publication language.");
  const photographs = await listAssetsForLot(orgId, lotId);
  if (approval.images.length > 20) throw new Error("Select at most 20 images.");
  if (approval.images.length && !approval.imageRights) throw new Error("Confirm permission to publish these images.");
  return getDb().transaction(async tx => {
    const [lot] = await tx.select().from(lots).where(and(eq(lots.id, lotId), eq(lots.orgId, orgId))).for("update");
    if (!lot) throw new PublicationError(404, "not_found", "Record not found.");
    const [org] = await tx.select().from(orgs).where(eq(orgs.id, orgId)).for("share");
    await requireAdministrator(orgId);
    const fields = approvedFields(lot.fields, approval.fields, org?.fieldPolicy, approval.language);
    if (!Object.hasOwn(fields, approval.titleField) || approval.descriptionFields.some(key => !Object.hasOwn(fields, key)))
      throw new Error("Title and description must use selected public fields.");
    const title = fields[approval.titleField]!.trim();
    if (!title || title.length > 500) throw new Error("The selected title must contain 1–500 characters.");
    const images = [...new Set(approval.images)].map(hash => {
      const photo = photographs.find(image => image.contentHash === hash);
      const width = photo?.geometry?.width, height = photo?.geometry?.height;
      if (!photo || !["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"].includes(photo.mimeType) ||
        typeof width !== "number" || typeof height !== "number" || !Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1)
        throw new Error("Select attached raster images with known dimensions.");
      return { hash, mimeType: photo.mimeType, alt: title, width, height };
    });
    let [publication] = await tx.select().from(publications).where(and(eq(publications.orgId, orgId), eq(publications.lotId, lotId), isNull(publications.withdrawnAt))).for("update");
    if (publication) await tx.update(publications).set({ origins, updatedAt: new Date() }).where(eq(publications.id, publication.id));
    else [publication] = await tx.insert(publications).values({ orgId, lotId, origins }).returning();
    // Re-publication receives a fresh identifier; withdrawn revision pins stay withdrawn.
    if (!publication) throw new Error("Unable to create publication.");
    const [revision] = await tx.insert(publicationRevisions).values({ orgId, publicationId: publication.id, approvedBy: actorId,
      snapshot: { title, description: approval.descriptionFields.map(key => fields[key]).join("\n\n"), fields, language: approval.language, images },
    }).returning();
    return { publicationId: publicId(publication.id), revision: publicId(revision!.id, "rev_") };
  });
}
export async function withdrawPublication(orgId: string, id: string) {
  await requireAdministrator(orgId);
  const actorId = await currentActorId(orgId);
  await getDb().transaction(async tx => {
    await tx.select({ id: orgs.id }).from(orgs).where(eq(orgs.id, orgId)).for("share");
    await requireAdministrator(orgId);
    const [row] = await tx.update(publications).set({ withdrawnAt: new Date(), withdrawnBy: actorId, updatedAt: new Date() })
      .where(and(eq(publications.orgId, orgId), eq(publications.id, privateId(id)))).returning({ id: publications.id });
    if (!row) throw new PublicationError(404, "not_found", "Publication not found.");
  });
}
export async function publicationForLot(orgId: string, lotId: string) {
  const [row] = await getDb().select().from(publications).where(and(eq(publications.orgId, orgId), eq(publications.lotId, lotId))).orderBy(desc(publications.createdAt), desc(publications.id)).limit(1);
  return row ?? null;
}
export async function readPublication(id: string, revision?: string) {
  const [publication] = await getDb().select().from(publications).where(eq(publications.id, privateId(id)));
  if (!publication) throw new PublicationError(404, "publication_not_found", "Publication not found.");
  if (publication.withdrawnAt) throw new PublicationError(410, "publication_withdrawn", "Publication withdrawn.");
  const [approved] = await getDb().select().from(publicationRevisions).where(and(
    eq(publicationRevisions.orgId, publication.orgId), eq(publicationRevisions.publicationId, publication.id),
    ...(revision ? [eq(publicationRevisions.id, privateId(revision, "rev_"))] : []),
  )).orderBy(desc(publicationRevisions.createdAt), desc(publicationRevisions.id)).limit(1);
  if (!approved) throw new PublicationError(404, revision ? "revision_not_found" : "publication_not_found", "Approved revision not found.");
  // A subsequently restricted field invalidates older approvals rather than leaking them.
  const [org] = await getDb().select({ policy: orgs.fieldPolicy }).from(orgs).where(eq(orgs.id, publication.orgId));
  try { approvedFields(approved.snapshot.fields, Object.keys(approved.snapshot.fields), org?.policy); }
  catch { throw new PublicationError(410, "publication_withdrawn", "Publication requires renewed approval."); }
  const origin = publicationOrigin(), actualRevision = publicId(approved.id, "rev_");
  const listing = { schemaVersion: "1", publicationId: id, revision: actualRevision, updatedAt: approved.createdAt.toISOString(),
    canonicalUrl: `${origin}/p/${id}`, title: approved.snapshot.title, description: approved.snapshot.description,
    language: approved.snapshot.language, fields: approved.snapshot.fields,
    images: approved.snapshot.images.map(image => ({ url: `${origin}/v1/publications/${id}/images/${image.hash}?revision=${actualRevision}`,
      alt: image.alt, width: image.width, height: image.height })),
  };
  return { listing, origins: publication.origins, snapshot: approved.snapshot };
}
