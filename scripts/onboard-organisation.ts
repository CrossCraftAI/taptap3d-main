import { getDb, getPool, memberships, orgs, users } from "../src/db";
import { eq } from "drizzle-orm";

const args = process.argv.slice(2);
function argument(name: string): string {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1]?.trim() ?? "" : "";
}
const name = argument("name"), slug = argument("slug"), email = argument("owner").toLowerCase();
try {
  const bootstrapOwner = args.includes("--bootstrap-owner");
  if ((!bootstrapOwner && !name) || name.length > 200 || !/^[a-z][a-z0-9-]{1,62}$/.test(slug) || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new Error('Usage: npm run org:onboard -- --name "House name" --slug house-name --owner owner@example.com');
  const orgId = await getDb().transaction(async tx => {
    // An existing tenant is never overwritten by this operator command.
    let org: { id: string } | undefined;
    if (bootstrapOwner) {
      [org] = await tx.select({ id: orgs.id }).from(orgs).where(eq(orgs.slug, slug)).for("update");
      if (!org) throw new Error("Organisation does not exist.");
      const currentMembers = await tx.select({ role: memberships.role }).from(memberships).where(eq(memberships.orgId, org.id));
      if (currentMembers.some(member => member.role === "owner")) throw new Error("An owner already exists; use team management.");
    } else [org] = await tx.insert(orgs).values({ name, slug }).returning({ id: orgs.id });
    await tx.insert(users).values({ email }).onConflictDoNothing({ target: users.email });
    const [person] = await tx.select({ id: users.id }).from(users).where(eq(users.email, email));
    await tx.insert(memberships).values({ orgId: org!.id, userId: person!.id, role: "owner" }).onConflictDoUpdate({
      target: [memberships.orgId, memberships.userId], set: { role: "owner", updatedAt: new Date() },
    });
    return org!.id;
  });
  console.log(`Organisation ready: ${orgId}. The owner can sign in with Google and manage team access in Settings.`);
} catch (error) {
  console.error(error instanceof Error && error.message.startsWith("Usage:") ? error.message : "Onboarding failed. Check the input, database connection and whether the slug already exists.");
  process.exitCode = 1;
} finally { await getPool().end(); }
