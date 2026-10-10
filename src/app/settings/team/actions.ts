"use server";
import { revalidatePath } from "next/cache";
import type { ActionState } from "@/components/action-form";
import { currentOrgId } from "@/lib/data/org";
import { admitMember, changeMember } from "@/lib/data/team";
import type { Role } from "@/lib/data/access";
export async function inviteAction(_state: ActionState, form: FormData): Promise<ActionState> {
  try {
    await admitMember(await currentOrgId(), String(form.get("email") ?? ""), String(form.get("role")) as Role);
    revalidatePath("/settings/team");
    return { ok: true, message: "Access granted. Share the sign-in link with your colleague; no email was sent automatically." };
  } catch (error) { return { ok: false, message: error instanceof Error ? error.message : "Unable to grant access." }; }
}
export async function memberAction(_state: ActionState, form: FormData): Promise<ActionState> {
  try {
    await changeMember(await currentOrgId(), String(form.get("userId")), String(form.get("role")) as Role | "remove");
    revalidatePath("/settings/team");
    return { ok: true, message: "Membership updated." };
  } catch (error) { return { ok: false, message: error instanceof Error ? error.message : "Unable to update access." }; }
}
