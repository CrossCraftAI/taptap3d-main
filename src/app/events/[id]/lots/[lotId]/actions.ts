"use server";

import { revalidatePath } from "next/cache";

import { currentActorId } from "@/lib/data/actor";
import { getCatalogue } from "@/lib/data/catalogues";
import { getLot, updateLotFields } from "@/lib/data/lots";
import { currentOrgId } from "@/lib/data/org";
import { setOverride } from "@/lib/data/overrides";
// The state type lives in src/lib/forms.ts, not here: a "use server" file may
// export only async functions, and its initial value is an object.
import type { LotFormState } from "@/lib/forms";

const FIELD_PREFIX = "field:";
const MAX_KEY = 80;
const MAX_VALUE = 20_000;

/**
 * Save the RECORD.
 *
 * Every field the form showed is posted, under `field:<key>`; a blank one
 * removes the key. This is the edit that reaches every catalogue of this event
 * and every future one — which is what a specialist means by "that title is
 * wrong". What one catalogue should print differently is the other action.
 *
 * The lot is checked against the org AND the event in the URL before anything
 * is written. Two ids arrive from the request; neither is an authorisation.
 */
export async function saveLotFieldsAction(
  eventId: string,
  lotId: string,
  _previous: LotFormState,
  formData: FormData,
): Promise<LotFormState> {
  const orgId = await currentOrgId();
  const lot = await getLot(orgId, lotId);
  if (!lot || lot.eventId !== eventId) {
    return { ok: false, message: "That lot is not in this sale.", at: Date.now() };
  }

  const patch: Record<string, string | null> = {};
  for (const [name, raw] of formData.entries()) {
    if (!name.startsWith(FIELD_PREFIX) || typeof raw !== "string") continue;
    const key = name.slice(FIELD_PREFIX.length);
    if (!key || key.length > MAX_KEY) continue;
    patch[key] = raw.slice(0, MAX_VALUE);
  }

  // A new column, under the house's own name. Kept out of the `field:` space so
  // a person cannot accidentally name a column "field:x".
  const newKey = String(formData.get("newKey") ?? "").trim();
  const newValue = String(formData.get("newValue") ?? "").trim();
  if (newKey && newValue) {
    if (newKey.length > MAX_KEY) {
      return { ok: false, message: "That column name is too long.", at: Date.now() };
    }
    if (newKey.startsWith("_")) {
      // The underscore namespace is carried data the caption never prints; a
      // column somebody typed in order to see it should not vanish into it.
      return {
        ok: false,
        message: "A column name cannot start with an underscore — those never print.",
        at: Date.now(),
      };
    }
    patch[newKey] = newValue.slice(0, MAX_VALUE);
  } else if (newKey || newValue) {
    return {
      ok: false,
      message: "A new column needs both a name and a value.",
      at: Date.now(),
    };
  }

  if (Object.keys(patch).length === 0) {
    return { ok: true, message: "Nothing to save.", at: Date.now() };
  }

  await updateLotFields(orgId, lotId, patch);

  // The lot, the sale's ledger, and the catalogue all show this record.
  revalidatePath(`/events/${eventId}/lots/${lotId}`);
  revalidatePath(`/events/${eventId}`);
  revalidatePath(`/events/${eventId}/catalogue`);
  return { ok: true, message: "Saved. Every catalogue of this sale prints it this way now.", at: Date.now() };
}

/**
 * Decide how THIS catalogue prints the lot.
 *
 * The form posts one `scope` per row it showed, and for each: `hide:<key>` when
 * the box is ticked and `text:<key>` for a replacement. Neither means "no
 * override", and any override there was is cleared — so the form is the whole
 * truth about the lot in this catalogue, and un-ticking a box is how a decision
 * is reversed (principle 9: a default, not a lock).
 *
 * THE WHOLE TRUTH ABOUT THESE TWO KEYS, AND ONLY THESE TWO. A write is now a
 * patch (src/lib/data/overrides.ts), so the form states both of them on every
 * submit — an empty box is sent as an empty string, which clears, rather than
 * omitted, which would leave the old text standing. Everything the form does
 * not know about, a dragged frame above all, is left exactly as it was: saving
 * this form must not undo work done in the editor, which is the failure the
 * patch exists to prevent and would be reintroduced here by omitting a key.
 *
 * The catalogue is resolved from the event, never taken from the form, and it
 * is READ, not ensured: a lot page is not a request for a catalogue.
 *
 * `decided_by` is the gate identity — see src/lib/data/actor.ts for why a
 * human's decision must not be written as null before sign-in exists.
 */
export async function setLotOverridesAction(
  eventId: string,
  lotId: string,
  _previous: LotFormState,
  formData: FormData,
): Promise<LotFormState> {
  const orgId = await currentOrgId();
  const [lot, catalogue] = await Promise.all([
    getLot(orgId, lotId),
    getCatalogue(orgId, eventId),
  ]);
  if (!lot || lot.eventId !== eventId) {
    return { ok: false, message: "That lot is not in this sale.", at: Date.now() };
  }
  if (!catalogue) {
    return {
      ok: false,
      message: "This sale has no catalogue yet. Open the catalogue once, then come back.",
      at: Date.now(),
    };
  }

  const decidedBy = await currentActorId(orgId);
  const scope = formData
    .getAll("scope")
    .filter((s): s is string => typeof s === "string" && s.length > 0 && s.length <= MAX_KEY);

  let changed = 0;
  for (const key of new Set(scope)) {
    const hidden = formData.get(`hide:${key}`) === "on";
    const text = String(formData.get(`text:${key}`) ?? "").trim().slice(0, MAX_VALUE);
    const done = await setOverride(
      orgId,
      catalogue.id,
      lotId,
      key,
      // The plate is a content hash, not text; only hiding it makes sense.
      key === "images" ? { hidden } : { hidden, text },
      decidedBy,
    );
    if (done) changed += 1;
  }

  revalidatePath(`/events/${eventId}/lots/${lotId}`);
  revalidatePath(`/events/${eventId}/catalogue`);
  return {
    ok: true,
    message:
      changed === 0
        ? "Nothing to apply."
        : "Applied to this catalogue only. The record is unchanged.",
    at: Date.now(),
  };
}
