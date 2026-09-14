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
  // THE EDITOR, not the event's list. M1.md §1 step 2 says "create an event →
  // an empty editor", and for a while this landed on the event's empty lot
  // table — a screen about the absence of a thing, with a card offering the
  // thing. Docs and Canva put a person on the blank page with the tools; so
  // does this. The editor with no lots is a blank sheet on the template's
  // geometry with the one way to fill it on the canvas, and it makes no
  // catalogue row until there is something to catalogue (catalogue/page.tsx).
  redirect(`/events/${event.id}/catalogue`);
}
