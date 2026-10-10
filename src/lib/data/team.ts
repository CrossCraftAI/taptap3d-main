import { and, eq, sql } from "drizzle-orm";
import { getDb, memberships, orgs, users } from "@/db";
import { requireOwner, type Role } from "./access";

export async function listMembers(orgId: string) {
  await requireOwner(orgId);
  return getDb().select({ id: users.id, email: users.email, name: users.name, role: memberships.role, joined: users.googleSub })
    .from(memberships).innerJoin(users, eq(users.id, memberships.userId)).where(eq(memberships.orgId, orgId)).orderBy(users.email);
}

/** The owner can admit by email before first Google sign-in. No automatic email is sent. */
export async function admitMember(orgId: string, email: string, role: Role): Promise<void> {
  await requireOwner(orgId);
  email = email.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !["owner", "admin", "member"].includes(role))
    throw new Error("Enter a valid email and role.");
  await getDb().transaction(async tx => {
    await tx.select({ id: orgs.id }).from(orgs).where(eq(orgs.id, orgId)).for("update");
    await requireOwner(orgId);
    await tx.insert(users).values({ email }).onConflictDoNothing({ target: users.email });
    const [user] = await tx.select({ id: users.id }).from(users).where(eq(users.email, email));
    if (!user) throw new Error("Account could not be admitted.");
    // Existing roles are changed explicitly, never as a side effect of re-inviting.
    await tx.insert(memberships).values({ orgId, userId: user.id, role }).onConflictDoNothing();
  });
}

export async function changeMember(orgId: string, userId: string, role: Role | "remove"): Promise<void> {
  await requireOwner(orgId);
  if (!["owner", "admin", "member", "remove"].includes(role)) throw new Error("Unknown role.");
  await getDb().transaction(async tx => {
    // Serialise all membership edits to prevent concurrent removal of both owners.
    await tx.select({ id: orgs.id }).from(orgs).where(eq(orgs.id, orgId)).for("update");
    await requireOwner(orgId);
    const [member] = await tx.select().from(memberships).where(and(eq(memberships.orgId, orgId), eq(memberships.userId, userId)));
    if (!member) throw new Error("Member not found.");
    if (member.role === "owner" && role !== "owner") {
      const [count] = await tx.select({ n: sql<number>`count(*)::int` }).from(memberships)
        .where(and(eq(memberships.orgId, orgId), eq(memberships.role, "owner")));
      if ((count?.n ?? 0) < 2) throw new Error("The organisation must retain an owner.");
    }
    if (role === "remove") await tx.delete(memberships).where(eq(memberships.id, member.id));
    else await tx.update(memberships).set({ role, updatedAt: new Date() }).where(eq(memberships.id, member.id));
  });
}
