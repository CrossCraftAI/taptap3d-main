// Who is acting, before there is a sign-in.
//
// ── THE GATE IDENTITY ───────────────────────────────────────────────────────
//
// `overrides.decided_by` exists to make ONE distinction: a human decided this,
// or a machine proposed it and nobody has confirmed. Null is the second. There
// is no authentication yet (ROADMAP D14) and no `users` row anywhere — so the
// obvious build, a human edit that stores null because there is no user to name,
// destroys the only distinction the column makes on the first day the vision
// model proposes anything. Every decision in the table would read as a proposal,
// and the corollary of principle 9 — a proposal is not an edit — would have
// nothing to stand on. The migration already did exactly this to the
// predecessor's thirteen hidden-field decisions, which now read as unconfirmed.
//
// So a human edit names WHO WE KNOW: someone at the house, who came through the
// gate. That is one `users` row per org, created on first use, with an address
// under `.invalid` (RFC 2606) that cannot receive mail and cannot collide with a
// real person's. It says exactly what is true — a human, before the system could
// say which one — and nothing more. The row is what schema.ts says `users` is
// for: "everything which references a person has something to reference".
//
// Rejected: a `decided_kind` flag column. schema.ts already says why —
// provenance is derived by comparison, not by a flag a restore could make lie.
// Rejected: marking proposals inside `value` (`{proposal: true}`), which the
// migration does as well. That is the same flag by another name, and the engine
// would have to know the shape of every future proposal in order to skip it.
// Rejected: an org-level "system" user with a real-looking address, which the
// first real sign-up would then be unable to claim.
//
// Like org.ts, this is written to die. When sign-in lands it becomes a session
// lookup and nothing that calls `currentActorId()` changes shape. Rows decided
// by the gate identity stay honest afterwards: a member of the house decided,
// before the system could name them.

import { eq } from "drizzle-orm";

import { getDb, memberships, orgs, users } from "@/db";

/**
 * Reserved by RFC 2606 so it can never resolve. Exported so a screen can tell a
 * gate identity from a person without knowing how the address is built.
 */
export const GATE_DOMAIN = "taptap3d.invalid";

export function gateEmail(orgSlug: string): string {
  return `gate@${orgSlug}.${GATE_DOMAIN}`;
}

export function isGateIdentity(email: string): boolean {
  return email.endsWith(`.${GATE_DOMAIN}`);
}

/**
 * The acting person, as far as the system can currently tell: the org's gate
 * identity. Created on first use, and made a member so the row is reachable the
 * way any real member's will be.
 *
 * Two first writes at once are ordinary — a specialist saving two lots in two
 * tabs — so the insert does nothing on conflict and the loser reads the winner
 * back, the same shape as `recordAsset`.
 */
export async function currentActorId(orgId: string): Promise<string> {
  const db = getDb();
  const [org] = await db
    .select({ slug: orgs.slug, name: orgs.name })
    .from(orgs)
    .where(eq(orgs.id, orgId))
    .limit(1);
  if (!org) throw new Error(`No org ${orgId}; nothing can act for it.`);

  const email = gateEmail(org.slug);
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (existing) return existing.id;

  const inserted = await db
    .insert(users)
    .values({ email, name: `${org.name} — via the gate` })
    .onConflictDoNothing({ target: users.email })
    .returning({ id: users.id });
  let id = inserted[0]?.id;
  if (!id) {
    const [won] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    id = won!.id;
  }

  await db
    .insert(memberships)
    .values({ orgId, userId: id, role: "member" })
    .onConflictDoNothing({ target: [memberships.orgId, memberships.userId] });

  return id;
}
