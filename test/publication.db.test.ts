import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
const identity = vi.hoisted(() => ({ userId: "", signedIn: true }));
vi.mock("@/lib/auth/session", () => ({ authConfigured: () => true, currentSession: async () => identity.signedIn ? { userId: identity.userId, email: "test@example.com", name: null } : null }));
import { getDb, getPool, memberships, orgs, lots, events, users, assets, lotAssets } from "@/db";
import { approvePublication, readPublication, withdrawPublication } from "@/lib/data/publications";
import { admitMember, changeMember } from "@/lib/data/team";
import { setFieldPolicy, setRecordTypes } from "@/lib/data/org";
import { publicId } from "@/lib/publication";
import { GET as imageGet } from "@/app/v1/publications/[publicationId]/images/[hash]/route";
import { GET as jsonGet } from "@/app/v1/publications/[publicationId]/route";
import { getAssetStore } from "@/lib/assets/store";
import { publicHtml } from "@/lib/publication-html";
const db = getDb(), suffix = randomUUID();
let orgA: string, orgB: string, owner: string, member: string, lotA: string, lotB: string, imageHash: string;
const approval = () => ({ fields: ["title", "description"], titleField: "title", descriptionFields: ["description"], images: [] as string[], imageRights: false, language: "en" as const, origins: ["https://shop.example.com"] });
beforeAll(async () => {
  vi.stubEnv("TAPTAP3D_PUBLIC_ORIGIN", "https://beta.example.com");
  const houses = await db.insert(orgs).values([{ name: "Publication A", slug: `pub-a-${suffix}` }, { name: "Publication B", slug: `pub-b-${suffix}` }]).returning();
  [orgA, orgB] = houses.map(row => row.id) as [string, string];
  const people = await db.insert(users).values([{ email: `pub-owner-${suffix}@example.com` }, { email: `pub-member-${suffix}@example.com` }]).returning();
  [owner, member] = people.map(row => row.id) as [string, string];
  await db.insert(memberships).values([{ orgId: orgA, userId: owner, role: "owner" }, { orgId: orgB, userId: member, role: "member" }]);
  const sales = await db.insert(events).values([{ orgId: orgA, name: "Public sale" }, { orgId: orgB, name: "Private sale" }]).returning();
  const records = await db.insert(lots).values([
    { orgId: orgA, eventId: sales[0]!.id, position: 0, fields: { title: "Vessel", description: "Ceramic", reserve: "secret" } },
    { orgId: orgB, eventId: sales[1]!.id, position: 0, fields: { title: "Other house secret" } },
  ]).returning();
  [lotA, lotB] = records.map(row => row.id) as [string, string];
  const blob = await getAssetStore().put(new Uint8Array([1,2,3,4])); imageHash = blob.hash;
  const [image] = await db.insert(assets).values({ orgId: orgA, contentHash: imageHash, mimeType: "image/png", byteSize: 4, geometry: { width: 100, height: 80 } }).returning();
  await db.insert(lotAssets).values({ orgId: orgA, lotId: lotA, assetId: image!.id });
});
beforeEach(() => { identity.userId = owner; identity.signedIn = true; });
afterAll(async () => {
  await db.delete(orgs).where(inArray(orgs.id, [orgA, orgB]));
  await db.delete(users).where(inArray(users.id, [owner, member]));
  await db.delete(users).where(eq(users.email, `new-${suffix}@example.com`));
  vi.unstubAllEnvs(); await getPool().end();
});
describe("pilot publication and team boundaries against Postgres", () => {
  it("requires a current administrator and the correct organisation for approval", async () => {
    await expect(approvePublication(orgA, lotB, approval())).rejects.toThrow(/Record not found/);
    identity.userId = member;
    await expect(approvePublication(orgA, lotA, approval())).rejects.toThrow(/administrator/);
    await expect(approvePublication(orgB, lotB, approval())).rejects.toThrow(/administrator/);
    await expect(setFieldPolicy(orgB, {})).rejects.toThrow(/administrator/);
    await expect(setRecordTypes(orgB, {})).rejects.toThrow(/administrator/);
    await expect(admitMember(orgB, "other@example.com", "owner")).rejects.toThrow(/owner/);
  });
  it("preserves the last owner, admits by email, and revokes only within the acting org", async () => {
    await expect(changeMember(orgA, owner, "remove")).rejects.toThrow(/retain an owner/);
    await expect(changeMember(orgA, member, "owner")).rejects.toThrow(/not found/);
    await admitMember(orgA, `NEW-${suffix}@example.com`, "member");
    const [person] = await db.select().from(users).where(eq(users.email, `new-${suffix}@example.com`));
    expect(person?.googleSub).toBeNull();
    await changeMember(orgA, person!.id, "admin");
    await changeMember(orgA, person!.id, "remove");
  });
  it("pins approved content, restricts origins, revokes images and every revision, and republishes with a fresh id", async () => {
    const input = { ...approval(), images: [imageHash], imageRights: true };
    const first = await approvePublication(orgA, lotA, input);
    const stored = await readPublication(first.publicationId);
    expect(stored.listing.fields).toEqual({ title: "Vessel", description: "Ceramic" });
    expect(JSON.stringify(stored.listing)).not.toContain("secret");
    await db.update(lots).set({ fields: { title: "Updated vessel", description: "Changed", reserve: "secret" } }).where(eq(lots.id, lotA));
    expect((await readPublication(first.publicationId)).listing.title).toBe("Vessel");
    const second = await approvePublication(orgA, lotA, input);
    expect(second.publicationId).toBe(first.publicationId);
    expect((await readPublication(first.publicationId)).listing.title).toBe("Updated vessel");
    expect((await readPublication(first.publicationId, first.revision)).listing.title).toBe("Vessel");
    const context = { params: Promise.resolve({ publicationId: first.publicationId }) };
    const allowed = await jsonGet(new Request(`https://beta.example.com/v1/publications/${first.publicationId}`, { headers: { Origin: "https://shop.example.com" } }), context);
    expect(allowed.headers.get("access-control-allow-origin")).toBe("https://shop.example.com");
    const denied = await jsonGet(new Request(`https://beta.example.com/v1/publications/${first.publicationId}`, { headers: { Origin: "https://other.example.com" } }), context);
    expect(denied.status).toBe(403);
    const html = await publicHtml(new Request(`https://beta.example.com/embed/${first.publicationId}`), first.publicationId, true);
    expect(html.headers.get("content-security-policy")).toContain("frame-ancestors 'self' https://shop.example.com");
    expect(html.headers.get("cache-control")).toBe("no-store");
    const imageContext = { params: Promise.resolve({ publicationId: first.publicationId, hash: imageHash }) };
    expect((await imageGet(new Request(`https://beta.example.com/image?revision=${first.revision}`), imageContext)).status).toBe(200);
    identity.userId = member;
    await expect(withdrawPublication(orgA, first.publicationId)).rejects.toThrow(/administrator/);
    identity.userId = owner;
    await withdrawPublication(orgA, first.publicationId);
    await expect(readPublication(first.publicationId, first.revision)).rejects.toMatchObject({ status: 410 });
    await expect(readPublication(first.publicationId, second.revision)).rejects.toMatchObject({ status: 410 });
    expect((await imageGet(new Request(`https://beta.example.com/image?revision=${first.revision}`), imageContext)).status).toBe(410);
    const next = await approvePublication(orgA, lotA, input);
    expect(next.publicationId).not.toBe(first.publicationId);
    await expect(readPublication(first.publicationId)).rejects.toMatchObject({ status: 410 });
    expect(publicId(lotA)).not.toBe(next.publicationId);
    await setFieldPolicy(orgA, { description: "house" });
    await expect(readPublication(next.publicationId)).rejects.toMatchObject({ status: 410 });
    await expect(approvePublication(orgA, lotA, input)).rejects.toThrow(/cannot be published/);
    await setFieldPolicy(orgA, {});
  });
});
