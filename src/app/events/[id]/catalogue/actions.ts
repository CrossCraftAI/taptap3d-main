"use server";

import { revalidatePath } from "next/cache";

import { ensureCatalogue, updateCatalogueParams } from "@/lib/data/catalogues";
import { currentOrgId } from "@/lib/data/org";
import { DENSITIES, normaliseParams } from "@/lib/engine/derive";

/**
 * Change the layout parameters.
 *
 * Density is a DEFAULT, NOT A LOCK (principle 9): it is stored so the catalogue
 * reopens where the specialist left it, and it re-derives every slot rather than
 * freezing any. Nothing keyed to a page survives this — nothing is keyed to a
 * page.
 */
export async function setCatalogueParamsAction(
  eventId: string,
  formData: FormData,
): Promise<void> {
  const orgId = await currentOrgId();
  const catalogue = await ensureCatalogue(orgId, eventId);

  const perPage = Number(formData.get("perPage"));
  const params = normaliseParams({
    perPage: DENSITIES.includes(perPage as (typeof DENSITIES)[number])
      ? perPage
      : undefined,
    imagePlacement: String(formData.get("imagePlacement") ?? ""),
    showRef: formData.get("showRef") === "on",
    fit: String(formData.get("fit") ?? ""),
  });

  await updateCatalogueParams(orgId, catalogue.id, { ...params });
  revalidatePath(`/events/${eventId}/catalogue`);
}
