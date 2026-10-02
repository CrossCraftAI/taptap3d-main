"use server";

import { revalidatePath } from "next/cache";

import { currentOrgId, setFieldPolicy, setRecordTypes } from "@/lib/data/org";
import { typesFromForm } from "@/lib/record-type-form";
import { MAX_KEY, isAudience, policyOf, type PolicyFormState } from "@/lib/settings";

/** How the form names one field's level. The rest of the name is the key. */
const LEVEL = "level:";

/**
 * Set the house's field policy.
 *
 * ── THE FORM IS THE WHOLE TRUTH, WHICH IS WHY IT POSTS EVERY ROW ────────────
 *
 * `setFieldPolicy` replaces the map rather than merging into it, and
 * src/lib/data/org.ts argues why at length: a merge would make "stop holding
 * this field back" inexpressible, because an absent key would mean "leave it
 * alone" rather than "it is public again". The consequence lands here — every
 * row the screen drew posts its level on every submit, so returning a field
 * to public is expressible and needs no sentinel.
 *
 * It also means the screen must draw every field somebody might want to
 * un-mark, which is what `policyRows` guarantees by including keys the policy
 * mentions and no lot carries any more.
 *
 * ── NOTHING ELSE IS REVALIDATED, AND THAT IS NOT AN OVERSIGHT ───────────────
 *
 * A policy change reaches every lot record and every catalogue of every sale.
 * None of them is cached: each of those routes is `force-dynamic` and
 * `fieldPolicyOf` is deliberately read per derivation and never memoised —
 * src/lib/data/org.ts says why, and the sentence is that a stale answer here
 * is a disclosure. So there is nothing to invalidate but this screen's own
 * rendering of what it just wrote.
 */
export async function setFieldPolicyAction(
  _previous: PolicyFormState,
  formData: FormData,
): Promise<PolicyFormState> {
  const decisions: [string, string][] = [];
  for (const [name, raw] of formData.entries()) {
    if (!name.startsWith(LEVEL) || typeof raw !== "string") continue;
    // `slice` and not `split`, because a house's own column may be called
    // "Estimate: HKD" and only the FIRST colon belongs to this form.
    decisions.push([name.slice(LEVEL.length), raw]);
  }

  // A field nobody has named yet — the case the screen exists to make
  // possible before an import rather than after one. Both halves are
  // required: a name with no level says nothing this map can hold, and a
  // level with no name has nothing to be about.
  const newKey = String(formData.get("newKey") ?? "").trim();
  const newLevel = String(formData.get("newLevel") ?? "").trim();
  if (newKey) {
    if (newKey.length > MAX_KEY) {
      return refuse(`A field name can be at most ${MAX_KEY} characters.`);
    }
    if (newKey.startsWith("_")) {
      return refuse(
        "A field name cannot start with an underscore — those are carried " +
          "values that never print, so a level on one would do nothing.",
      );
    }
    if (!isAudience(newLevel)) {
      return refuse("Choose which readership may have that field.");
    }
    if (newLevel === "public") {
      return refuse(
        `Every field is public until the house says otherwise, so naming ` +
          `“${newKey}” as public changes nothing. Pick internal or house, or ` +
          `leave the name blank.`,
      );
    }
    decisions.push([newKey, newLevel]);
  } else if (isAudience(newLevel) && newLevel !== "public") {
    return refuse("Name the field that level is about.");
  }

  const orgId = await currentOrgId();
  const stored = await setFieldPolicy(orgId, policyOf(decisions));
  const marked = Object.keys(stored).length;

  revalidatePath("/settings");
  return {
    ok: true,
    message:
      marked === 0
        ? "Saved. No field is held back, so every output carries everything."
        : `Saved. ${marked} ${marked === 1 ? "field is" : "fields are"} held ` +
          "back — from every sale, in every catalogue, at once.",
    at: Date.now(),
  };
}

function refuse(message: string): PolicyFormState {
  return { ok: false, message, at: Date.now() };
}

/**
 * Set the house's record types.
 *
 * ── THE FORM IS THE WHOLE TRUTH, FOR THE SAME REASON AS THE POLICY ABOVE ───
 *
 * `setRecordTypes` replaces rather than merges, so the screen posts every
 * type and every property on every submit. That is what makes deleting one
 * expressible from the only screen that can delete one — a merge would leave
 * "remove this type" with no way to say it.
 *
 * ── IT REFUSES NOTHING AND DROPS WHAT IT CANNOT USE ────────────────────────
 *
 * `typesFromForm` is total, and the empty row at the bottom that an "add
 * another" button leaves behind is the reason: a screen that declined to save
 * eleven good types over one blank row would be unusable by the second
 * afternoon. What arrives half-filled is dropped and what is good is kept,
 * and the screen then redraws what was actually stored — so a person can see
 * which of their rows survived rather than being told a number.
 */
export async function setRecordTypesAction(
  _previous: PolicyFormState,
  formData: FormData,
): Promise<PolicyFormState> {
  const orgId = await currentOrgId();
  const stored = await setRecordTypes(orgId, typesFromForm(formData.entries()));
  const kinds = Object.keys(stored).length;
  // THE SAME REVALIDATION ARGUMENT AS THE POLICY, with one addition: the
  // import clearance screen reads these to draw its picker, and a house that
  // has just defined its first type expects to find it there.
  revalidatePath("/settings");
  return {
    ok: true,
    message:
      kinds === 0
        ? "No kinds are defined. Every lot is of no particular kind."
        : `Saved. ${kinds} ${kinds === 1 ? "kind" : "kinds"} of thing.`,
    at: Date.now(),
  };
}
