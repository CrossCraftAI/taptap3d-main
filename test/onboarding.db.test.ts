import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { getDb, getPool, memberships, orgs, users } from "@/db";
it("operator onboarding is atomic, refuses overwrite, and bootstraps only organisations without an owner", async () => {
  const slug = `onboard-${randomUUID()}`, email = `${slug}@example.com`;
  const run = (...args: string[]) => spawnSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "scripts/onboard-organisation.ts", ...args], { encoding: "utf8", env: process.env });
  const db = getDb();
  try {
    const first = run("--name", "Pilot fixture", "--slug", slug, "--owner", email);
    expect(first.status, first.stderr).toBe(0);
    const [org] = await db.select().from(orgs).where(eq(orgs.slug, slug));
    expect(org?.name).toBe("Pilot fixture");
    const [member] = await db.select().from(memberships).where(eq(memberships.orgId, org!.id));
    expect(member?.role).toBe("owner");
    expect(run("--name", "Overwrite", "--slug", slug, "--owner", email).status).toBe(1);
    expect(run("--bootstrap-owner", "--slug", slug, "--owner", email).status).toBe(1);
    await db.update(memberships).set({ role: "member" }).where(eq(memberships.id, member!.id));
    expect(run("--bootstrap-owner", "--slug", slug, "--owner", email).status).toBe(0);
    const [restored] = await db.select().from(memberships).where(eq(memberships.id, member!.id));
    expect(restored?.role).toBe("owner");
  } finally {
    await db.delete(orgs).where(eq(orgs.slug, slug));
    await db.delete(users).where(eq(users.email, email));
    await getPool().end();
  }
}, 30000);
