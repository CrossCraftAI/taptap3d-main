import { and, eq } from "drizzle-orm";
import { getDb, memberships } from "@/db";
import { authConfigured, currentSession } from "@/lib/auth/session";

export type Role = "owner" | "admin" | "member";

export async function organisationRole(orgId: string): Promise<Role | null> {
  if (process.env.TAPTAP3D_REQUIRE_AUTH === "true" && !authConfigured()) return null;
  // The existing single-house developer/shared-gate mode has no human roles.
  if (!authConfigured()) return "owner";
  const session = await currentSession();
  if (!session) return null;
  const [row] = await getDb().select({ role: memberships.role }).from(memberships)
    .where(and(eq(memberships.orgId, orgId), eq(memberships.userId, session.userId))).limit(1);
  return row?.role ?? null;
}

export async function requireAdministrator(orgId: string): Promise<void> {
  const role = await organisationRole(orgId);
  if (role !== "owner" && role !== "admin") throw new Error("An organisation administrator is required.");
}

export async function requireOwner(orgId: string): Promise<void> {
  if (await organisationRole(orgId) !== "owner") throw new Error("The organisation owner is required.");
}
