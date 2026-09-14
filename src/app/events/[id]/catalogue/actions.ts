"use server";

import { revalidatePath } from "next/cache";

import {
  createPin,
  deletePin,
  ensureCatalogue,
  updateCatalogueParams,
} from "@/lib/data/catalogues";
import { currentOrgId } from "@/lib/data/org";
import { normaliseParams } from "@/lib/engine/derive";
// From src/lib/forms.ts, because a "use server" file may export only async
// functions and the panel's initial state is an object.
import type { PinFormState } from "@/lib/forms";

/**
 * Pin the selected lots together.
 *
 * The selection arrives as one `lotId` per ticked box — the MEMBERS, and
 * nothing about where they were on screen when the specialist chose them.
 * `createPin` refuses a selection the engine could not honour and says why;
 * that answer comes back to the panel instead of a pin that does nothing.
 */
export async function pinTogetherAction(
  eventId: string,
  _previous: PinFormState,
  formData: FormData,
): Promise<PinFormState> {
  const orgId = await currentOrgId();
  const catalogue = await ensureCatalogue(orgId, eventId);
  const lotIds = formData
    .getAll("lotId")
    .filter((v): v is string => typeof v === "string" && v.length > 0);

  const result = await createPin(orgId, catalogue.id, lotIds);
  if (!result.ok) return { message: result.reason, at: Date.now() };

  revalidatePath(`/events/${eventId}/catalogue`);
  return { message: null, at: Date.now() };
}

/** Unpin. Bound to its ids by the panel; the form carries nothing else. */
export async function unpinAction(
  eventId: string,
  pinId: string,
  _formData: FormData,
): Promise<void> {
  const orgId = await currentOrgId();
  await deletePin(orgId, pinId);
  revalidatePath(`/events/${eventId}/catalogue`);
}

/**
 * Change the template or the layout parameters.
 *
 * Density is a DEFAULT, NOT A LOCK (principle 9): it is stored so the catalogue
 * reopens where the specialist left it, and it re-derives every slot rather than
 * freezing any. Nothing keyed to a page survives this — nothing is keyed to a
 * page. Nor does a template change touch an override or a pin: both are keyed
 * to lots, and the engine re-applies them on the price list exactly as it did
 * on the grid.
 *
 * Everything posted is resolved AGAINST THE TEMPLATE by `normaliseParams`: a
 * density the new template does not offer becomes its default, a placement it
 * has no plate for becomes the one it has. The form does not know the
 * template's vocabulary and does not need to.
 */
export async function setCatalogueParamsAction(
  eventId: string,
  formData: FormData,
): Promise<void> {
  const orgId = await currentOrgId();
  const catalogue = await ensureCatalogue(orgId, eventId);

  const params = normaliseParams({
    template: String(formData.get("template") ?? ""),
    perPage: Number(formData.get("perPage")),
    imagePlacement: String(formData.get("imagePlacement") ?? ""),
    showRef: formData.get("showRef") === "on",
    fit: String(formData.get("fit") ?? ""),
  });

  await updateCatalogueParams(orgId, catalogue.id, { ...params });
  revalidatePath(`/events/${eventId}/catalogue`);
}
