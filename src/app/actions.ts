"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createEvent } from "@/lib/data/events";
import { currentOrgId } from "@/lib/data/org";

/**
 * Quick-add.
 *
 * A server action rather than a fetch to an API route: the form works before
 * JavaScript loads, which on a demo laptop tethered to a phone in a client's
 * boardroom is not a hypothetical. `createEvent` is the same function a script
 * or a test would call.
 */
export async function createEventAction(formData: FormData): Promise<void> {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;

  const rawDate = String(formData.get("heldOn") ?? "").trim();
  // An invalid date is dropped rather than refused. The date is optional — a
  // catalogue is routinely in production months before one is fixed — so a
  // typo in it must not cost the specialist the event they were creating.
  const parsed = rawDate ? new Date(rawDate) : null;
  const heldOn = parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;

  const orgId = await currentOrgId();
  const event = await createEvent(orgId, { name, heldOn });

  revalidatePath("/");
  redirect(`/events/${event.id}`);
}
