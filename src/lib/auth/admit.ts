// Google says who you are. This says whether you belong here.
//
// ── THE TWO QUESTIONS ARE NOT THE SAME ONE, AND CONFLATING THEM IS THE BUG ─
//
// Google will happily authenticate any of its two billion accounts. A sign-in
// that trusts that is a sign-in that lets the entire internet into a client's
// unpublished reserves. So authentication ends at "this is registrar@house.hk,
// and Google is sure"; admission is a separate question with a separate
// answer, and the answer is in this product's own database.
//
// ── MEMBERSHIP IS THE ANSWER, AND THE TABLE ALREADY EXISTED ────────────────
//
// `memberships(org_id, user_id, role)` has been in the schema since the first
// migration, carrying an `owner | admin | member` role that nothing has ever
// read. It is the right answer rather than a convenient one: an allowlist in
// an environment variable would be a second place identity lives, could not
// express a role, and could not say WHICH house somebody belongs to — which
// is the question that matters the moment there are two.
//
// So a person is admitted when a membership row exists for their address.
// Adding somebody is inserting a row; an invitation screen is a later, small
// thing that writes the same row.
//
// ── WHY THE ADDRESS AND NOT THE SUBJECT, ON THE FIRST VISIT ────────────────
//
// A house invites a colleague by email, because that is the only thing they
// know about them. Google's `sub` is what the session is bound to afterwards
// — an address can be renamed, and a renamed address that is later reissued
// must not inherit the first person's house. So: look up by address once,
// attach the sub, and match on the sub from then on.

import { and, eq, isNull, or } from "drizzle-orm";

import { getDb, memberships, users } from "@/db";

export type Admission =
  | { ok: true; userId: string }
  /** `reason` is for a log. What the person is told is the route's business. */
  | { ok: false; reason: string };

/**
 * Whether this Google account may sign in, and as which user row.
 *
 * ── AN UNVERIFIED ADDRESS IS REFUSED ───────────────────────────────────────
 *
 * Google reports `email_verified` false for some workspace and federated
 * configurations, and an unverified address is one anybody could have claimed
 * — which would turn "invite by email" into "anybody who can guess the email
 * of somebody you invited".
 */
export async function admit(identity: {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
}): Promise<Admission> {
  if (!identity.emailVerified) {
    return { ok: false, reason: `${identity.email} is not verified by Google.` };
  }

  const db = getDb();

  // MATCHED ON THE SUBJECT FIRST, then on an address that has never been
  // claimed. The `isNull` half is what makes an invitation work exactly once:
  // a row already bound to a different Google account is not a way in, even
  // for somebody who has since been given that address.
  const [user] = await db
    .select({ id: users.id, googleSub: users.googleSub, name: users.name })
    .from(users)
    .where(
      or(
        eq(users.googleSub, identity.sub),
        and(eq(users.email, identity.email), isNull(users.googleSub)),
      ),
    )
    .limit(1);

  if (!user) {
    return { ok: false, reason: `${identity.email} has no account here.` };
  }

  // A MEMBERSHIP OF SOMETHING. Which house is a question for the request
  // (src/lib/data/org.ts); this only asks whether they belong to any, because
  // a user row with no membership is somebody who has been removed, and
  // removing somebody has to be what locks them out.
  const [member] = await db
    .select({ orgId: memberships.orgId })
    .from(memberships)
    .where(eq(memberships.userId, user.id))
    .limit(1);
  if (!member) {
    return { ok: false, reason: `${identity.email} is not a member of any house.` };
  }

  // FIRST SIGN-IN BINDS THE ACCOUNT. Also fills the name, because an invited
  // row has an address and nothing else, and every screen that credits a
  // decision would otherwise print an email.
  if (user.googleSub === null) {
    await db
      .update(users)
      .set({ googleSub: identity.sub, name: user.name ?? identity.name, updatedAt: new Date() })
      .where(eq(users.id, user.id));
  }

  return { ok: true, userId: user.id };
}
