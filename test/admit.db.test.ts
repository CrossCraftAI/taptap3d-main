// Who Google authenticates, and who this product lets in.
//
// ── THESE ARE THE ASSERTIONS THAT MATTER MOST IN THE REPOSITORY ────────────
//
// Google will authenticate any of its accounts. Everything that keeps one
// house's unpublished reserves away from the rest of the internet is in
// `admit` and in the session lookup behind it, and every case below is a way
// somebody gets in who should not.
//
// Needs a database and says so by failing — see test/schema.db.test.ts on why
// there is no skip path anywhere in this suite.

import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getDb, getPool, memberships, orgs, users } from "@/db";
import { admit } from "@/lib/auth/admit";

const db = getDb();
let orgId: string;

const google = (over: Partial<Parameters<typeof admit>[0]> = {}) => ({
  sub: `sub-${randomUUID()}`,
  email: `person-${randomUUID().slice(0, 8)}@house.hk`,
  emailVerified: true,
  name: "A Person",
  ...over,
});

/** A row the house has created but nobody has signed in against yet. */
async function invite(email: string, member = true): Promise<string> {
  const [user] = await db.insert(users).values({ email }).returning({ id: users.id });
  if (member) await db.insert(memberships).values({ orgId, userId: user!.id });
  return user!.id;
}

beforeAll(async () => {
  const [row] = await db
    .insert(orgs)
    .values({ name: "Admit", slug: `admit-${randomUUID().slice(0, 8)}` })
    .returning({ id: orgs.id });
  orgId = row!.id;
});

afterAll(async () => {
  await db.delete(orgs).where(eq(orgs.id, orgId));
  await getPool().end();
});

describe("a Google account is not an account here", () => {
  it("refuses an address nobody invited", async () => {
    // THE DEFAULT ANSWER IS NO. If this ever returns ok, the whole internet
    // is a member of every house on the deployment.
    const answer = await admit(google());
    expect(answer.ok).toBe(false);
  });

  it("refuses an invited address Google has not verified", async () => {
    // Google reports `email_verified` false for some federated setups, and an
    // unverified address is one anybody could have claimed — which would turn
    // "invite by email" into "guess the email of somebody who was invited".
    const email = `unverified-${randomUUID().slice(0, 8)}@house.hk`;
    await invite(email);
    expect((await admit(google({ email, emailVerified: false }))).ok).toBe(false);
  });

  it("refuses a user row with no membership", async () => {
    // Removing somebody from a house has to be what locks them out. A user
    // row survives so the decisions they made keep naming a person.
    const email = `former-${randomUUID().slice(0, 8)}@house.hk`;
    await invite(email, false);
    expect((await admit(google({ email }))).ok).toBe(false);
  });

  it("admits an invited member, and binds the account on the way in", async () => {
    const email = `new-${randomUUID().slice(0, 8)}@house.hk`;
    const userId = await invite(email);
    const identity = google({ email });

    const answer = await admit(identity);
    expect(answer).toEqual({ ok: true, userId });

    // THE SUBJECT IS ATTACHED, which is what makes every later sign-in match
    // on something that cannot be reassigned.
    const [row] = await db
      .select({ sub: users.googleSub, name: users.name })
      .from(users)
      .where(eq(users.id, userId));
    expect(row?.sub).toBe(identity.sub);
    expect(row?.name).toBe("A Person");
  });

  it("matches on the subject afterwards, even when the address has changed", async () => {
    // An address can be renamed at the provider. The person is the same
    // person and must not be locked out of their own house.
    const email = `renamed-${randomUUID().slice(0, 8)}@house.hk`;
    const userId = await invite(email);
    const identity = google({ email });
    await admit(identity);

    const answer = await admit({ ...identity, email: `else-${randomUUID().slice(0, 8)}@x.hk` });
    expect(answer).toEqual({ ok: true, userId });
  });

  /**
   * THE ONE THAT WOULD BE A BREACH, and the reason `admit` matches an address
   * only while `google_sub` is null.
   *
   * A house invites registrar@house.hk. They sign in; the row is bound to
   * their Google subject. Later the address is deleted at the provider and
   * reissued to a new employee — or an attacker persuades the provider to
   * issue it. Without the `isNull` half, that second Google account would
   * match the row by address and inherit the first person's house.
   */
  it("does not hand a claimed row to a second account with the same address", async () => {
    const email = `reissued-${randomUUID().slice(0, 8)}@house.hk`;
    await invite(email);
    expect((await admit(google({ email }))).ok).toBe(true);

    // Same address, different Google account.
    const answer = await admit(google({ email }));
    expect(answer.ok).toBe(false);
  });
});
