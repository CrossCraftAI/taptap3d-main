// ── WHY THERE IS NO `server-only` IMPORT ──────────────────────────────────
//
// It is the usual guard and it is a dependency this repository does not have.
// It is also unnecessary here: this module imports `node:crypto` and
// `next/headers`, and either one in a client bundle is a build error naming
// the file. The same reasoning is why `src/lib/data/*` has never needed one —
// they import the pool. Where the boundary genuinely needed help, the split
// was made in the code instead: `override-value.ts` exists because the polish
// panel wanted `mergeOverride` without dragging Postgres into the browser.

// Who is signed in, and how the browser is asked.
//
// ── NO LIBRARY, AND THAT IS A DECISION RATHER THAN A SAVING ────────────────
//
// Next's own guide recommends an auth library, and for username-and-password
// with social logins and MFA it is right — that is a lot of surface to get
// wrong. This product needs one provider, one cookie and one table, and the
// whole of it is below. What a library would have added here is a second
// configuration language over the same three things, plus its own opinions
// about where the org lives, which this schema already answers.
//
// The parts that are easy to get wrong are named where they happen: the token
// is stored as a hash, the cookie is `httpOnly` + `SameSite=Lax`, the state
// parameter is compared before the code is exchanged, and the session id is
// 256 bits from `crypto.getRandomValues`.

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { and, eq, gt, lt } from "drizzle-orm";
import { cookies } from "next/headers";

import { getDb, sessions, users } from "@/db";

/** The cookie the browser carries. */
export const SESSION_COOKIE = "taptap3d_session";
/** The short-lived cookie that carries the OAuth `state` across the redirect. */
export const STATE_COOKIE = "taptap3d_oauth_state";

/**
 * How long a sign-in lasts.
 *
 * FOURTEEN DAYS, and the number is a domain guess rather than a default: a
 * sale is worked on over a fortnight (the cycle spec's own word), so a
 * specialist should not be asked to sign in again in the middle of one. It is
 * a database session, so it can be revoked the moment that turns out wrong.
 */
export const SESSION_DAYS = 14;

/**
 * Whether sign-in is configured at all.
 *
 * ── THE PRODUCT HAS TO RUN WITHOUT IT, AND NOT AS A COURTESY ───────────────
 *
 * Every e2e spec in this repository builds a sale from nothing against a
 * local server, and a developer cloning this cannot be asked for a Google
 * project before the tests will run. So the absence of credentials is a
 * SUPPORTED STATE, the way an absent GATE_PASSWORD and an absent
 * PUPPETEER_EXECUTABLE_PATH already are — the application behaves exactly as
 * it did before sign-in existed, and `currentActorId` falls back to the gate
 * identity it has always used.
 *
 * It is read from the environment on every call rather than captured at
 * module load, because the test suite and the deployed container set it at
 * different times and a captured value is a value that is wrong in one of
 * them.
 */
export function authConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

/** A 256-bit token, base64url, for the cookie. Never stored. */
export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * What goes in the table.
 *
 * A PLAIN SHA-256 AND NOT BCRYPT, deliberately. A password hash is slow
 * because a password is guessable; this is 256 bits of randomness with no
 * dictionary behind it, so there is nothing for work factor to buy and a slow
 * hash would be paid on every request instead.
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Constant-time, for the reason src/proxy.ts gives about its own compare. */
export function sameToken(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export interface SignedIn {
  userId: string;
  email: string;
  name: string | null;
}

/**
 * The person this request belongs to, or null.
 *
 * READS, AND DOES NOT WRITE. It is called from server components as well as
 * from actions, and a cookie cannot be set during a render (Next's own note
 * on `cookies`). `seenAt` is therefore bumped by the sign-in and by the
 * callback, not here.
 *
 * EXPIRY IS CHECKED IN THE QUERY. Comparing in JavaScript would work and
 * would put the answer at the mercy of the two clocks agreeing; `now()` is
 * Postgres's, which is the clock the row was written against.
 */
export async function currentSession(): Promise<SignedIn | null> {
  if (!authConfigured()) return null;
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const db = getDb();
  const [row] = await db
    .select({ userId: users.id, email: users.email, name: users.name })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        eq(sessions.tokenHash, hashToken(token)),
        gt(sessions.expiresAt, new Date()),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Write the row and return the token the browser should carry. */
export async function openSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = newToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  const db = getDb();
  await db.insert(sessions).values({ userId, tokenHash: hashToken(token), expiresAt });
  // SWEPT ON SIGN-IN, not by a cron this deployment does not have. Expired
  // rows are unreachable either way; this keeps the table from growing
  // without bound on the one event that is already writing to it.
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
  return { token, expiresAt };
}

/** Forget this browser. Idempotent: signing out twice is not an error. */
export async function closeSession(token: string | undefined): Promise<void> {
  if (!token) return;
  await getDb().delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
}

/**
 * The cookie's options, in one place because getting one of them wrong is the
 * whole of the vulnerability.
 *
 * `httpOnly` so script cannot read it. `sameSite: "lax"` so it survives the
 * redirect back from Google (a cross-site GET) and is not sent on a
 * cross-site POST. `secure` everywhere but local http, because a cookie
 * without it travels in clear on any http hop.
 */
export function cookieOptions(expires: Date): {
  httpOnly: true;
  sameSite: "lax";
  secure: boolean;
  path: string;
  expires: Date;
} {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires,
  };
}
