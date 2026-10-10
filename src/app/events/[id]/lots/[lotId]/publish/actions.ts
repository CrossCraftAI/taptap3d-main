"use server";
import { revalidatePath } from "next/cache";
import type { ActionState } from "@/components/action-form";
import { currentOrgId } from "@/lib/data/org";
import { approvePublication, withdrawPublication } from "@/lib/data/publications";
export async function approveAction(_state: ActionState, form: FormData): Promise<ActionState> {
  try {
    if (form.get("reviewed") !== "on") throw new Error("Confirm that you reviewed the public content.");
    const result = await approvePublication(await currentOrgId(), String(form.get("lotId")), {
      fields: form.getAll("fields").map(String), titleField: String(form.get("titleField")),
      descriptionFields: form.getAll("descriptionFields").map(String), images: form.getAll("images").map(String),
      imageRights: form.get("imageRights") === "on", language: String(form.get("language")) as "en" | "zh-Hant",
      origins: String(form.get("origins") ?? "").split(/\r?\n/).map(value => value.trim()).filter(Boolean),
    });
    revalidatePath("/events", "layout");
    return { ok: true, message: `Approved ${result.revision}. The public links are ready below.` };
  } catch (error) { return { ok: false, message: error instanceof Error ? error.message : "Approval failed." }; }
}
export async function withdrawAction(_state: ActionState, form: FormData): Promise<ActionState> {
  try {
    if (form.get("confirmed") !== "on") throw new Error("Confirm withdrawal of every revision.");
    await withdrawPublication(await currentOrgId(), String(form.get("publicationId")));
    revalidatePath("/events", "layout");
    return { ok: true, message: "Withdrawn. All revision and image URLs now refuse new reads." };
  } catch (error) { return { ok: false, message: error instanceof Error ? error.message : "Withdrawal failed." }; }
}
