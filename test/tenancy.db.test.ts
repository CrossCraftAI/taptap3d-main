import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const identity = vi.hoisted(() => ({ userId: "", selected: undefined as string | undefined, signedIn: true, configured: true }));
vi.mock("@/lib/auth/session", () => ({
  authConfigured: () => identity.configured,
  currentSession: async () => identity.signedIn ? { userId: identity.userId, email: "member@example.com", name: null } : null,
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => identity.selected ? { value: identity.selected } : undefined }) }));

import { getDb, getPool, memberships, orgs, users } from "@/db";
import { availableHouses, currentOrgId } from "@/lib/data/org";

const db = getDb();
const suffix = randomUUID();
let houseA: string;
let houseB: string;
let outsider: string;

beforeAll(async () => {
  const houses = await db.insert(orgs).values([
    { name: "A", slug: `tenant-a-${suffix}` }, { name: "B", slug: `tenant-b-${suffix}` },
    { name: "Other", slug: `tenant-other-${suffix}` },
  ]).returning({ id: orgs.id });
  [houseA, houseB, outsider] = houses.map((house) => house.id) as [string, string, string];
  const [person] = await db.insert(users).values({ email: `tenant-${suffix}@example.com` }).returning({ id: users.id });
  identity.userId = person!.id;
  await db.insert(memberships).values([{ orgId: houseA, userId: identity.userId }, { orgId: houseB, userId: identity.userId }]);
});
beforeEach(() => { identity.selected = undefined; identity.signedIn = true; identity.configured = true; vi.stubEnv("TAPTAP3D_ORG_SLUG", ""); vi.stubEnv("TAPTAP3D_REQUIRE_AUTH", "false"); });
afterAll(async () => {
  vi.unstubAllEnvs();
  await db.delete(orgs).where(inArray(orgs.id, [houseA, houseB, outsider]));
  await db.delete(users).where(eq(users.id, identity.userId));
  await getPool().end();
});
describe("authenticated tenant resolution against Postgres", () => {
  it("a customer deployment cannot fall back to developer tenancy when authentication is missing", async () => {
    identity.configured = false;
    vi.stubEnv("TAPTAP3D_REQUIRE_AUTH", "true");
    vi.stubEnv("TAPTAP3D_ORG_SLUG", `tenant-a-${suffix}`);
    await expect(currentOrgId()).rejects.toThrow(/Authentication configuration is required/);
  });
  it("offers memberships only, never all houses", async () => {
    expect((await availableHouses()).map((house) => house.id)).toEqual([houseA, houseB]);
    await expect(currentOrgId()).rejects.toThrow(/Choose/);
  });
  it("switches between memberships", async () => {
    identity.selected = houseA;
    expect(await currentOrgId()).toBe(houseA);
    identity.selected = houseB;
    expect(await currentOrgId()).toBe(houseB);
  });
  it("rejects a forged cookie naming an outsider", async () => {
    identity.selected = outsider;
    await expect(currentOrgId()).rejects.toThrow(/Choose/);
  });
  it("an env pin cannot bypass authentication", async () => {
    vi.stubEnv("TAPTAP3D_ORG_SLUG", `tenant-a-${suffix}`);
    identity.signedIn = false;
    await expect(currentOrgId()).rejects.toThrow(/Not signed in/);
  });
  it("an env pin cannot bypass membership", async () => {
    vi.stubEnv("TAPTAP3D_ORG_SLUG", `tenant-other-${suffix}`);
    await expect(currentOrgId()).rejects.toThrow(/Choose/);
  });
  it("revocation takes effect with an existing house cookie", async () => {
    identity.selected = houseB;
    await db.delete(memberships).where(eq(memberships.orgId, houseB));
    await expect(currentOrgId()).rejects.toThrow(/Choose/);
  });
});
