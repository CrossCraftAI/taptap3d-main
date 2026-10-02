import { NextResponse, type NextRequest } from "next/server";

// The front door, in proxy.ts rather than middleware.ts.
//
// Next 16 deprecated the `middleware` filename and the `middleware` export in
// favour of `proxy`, to make the network boundary explicit. `proxy` runs on the
// nodejs runtime and cannot be configured to edge.
//
// ── WHAT THIS IS AND, MORE IMPORTANTLY, WHAT IT IS NOT ─────────────────────
//
// It is a REDIRECT for people who are not signed in. It is not the access
// control, and it must not be mistaken for one, because it cannot be:
//
//   Next's own guidance on this file is that proxy code "is meant to be
//   invoked separately of your render code" and "should not attempt relying
//   on shared modules or globals". So it cannot open the database, which
//   means it cannot tell a real session cookie from a string somebody typed.
//
// The real check is `currentSession()` behind `currentOrgId()`
// (src/lib/data/org.ts), which every page and every action passes through and
// which refuses outright when sign-in is configured and no session resolves.
// A forged cookie gets past this file and gets nothing.
//
// What this buys is the difference between a signed-out person seeing a
// sign-in page and a signed-out person seeing an error.
//
// ── IT REPLACED A SHARED PASSWORD ──────────────────────────────────────────
//
// There was one HTTP basic secret in front of the whole deployed instance,
// because the predecessor shipped to the public internet with no gate at all
// and an unauthenticated DELETE that destroyed a project. It did its job and
// it could not be revoked for one person, could not say who did anything, and
// made `overrides.decided_by` name a gate identity instead of a human.
//
// THE GATE IS STILL HERE, BEHIND A CONDITION, and that is deliberate rather
// than lazy: on a deployment with no Google project — every developer's
// machine, every end-to-end run — sign-in cannot be required, and a staging
// box with GATE_PASSWORD set should still not be a public database. So:
// sign-in when it is configured, the shared secret when it is not and one is
// set, and nothing at all locally.

const REALM = 'Basic realm="taptap3d", charset="UTF-8"';

/** The cookie name, duplicated from src/lib/auth/session.ts ON PURPOSE.
 *  Importing it would be exactly the shared module Next says not to rely on
 *  here, and it is a constant string; the test suite asserts the two agree. */
const SESSION_COOKIE = "taptap3d_session";

/**
 * Compare without leaking length or position through timing.
 *
 * A shared gate is not a high-value secret, but a comparison that returns early
 * is the kind of thing that gets copied into somewhere it matters.
 */
function safeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left[i]! ^ right[i]!;
  return diff === 0;
}

function unauthorised(): NextResponse {
  return new NextResponse("Authentication required.", {
    status: 401,
    headers: { "WWW-Authenticate": REALM },
  });
}

/** The paths a signed-out browser must be able to reach, or it can never
 *  sign in: the page itself, and the two halves of the Google round trip. */
function isPublic(pathname: string): boolean {
  return pathname === "/sign-in" || pathname.startsWith("/api/auth/");
}

export function proxy(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;

  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    if (isPublic(pathname)) return NextResponse.next();
    if (request.cookies.get(SESSION_COOKIE)) return NextResponse.next();

    const signIn = new URL("/sign-in", request.url);
    // WHERE THEY WERE GOING, so a bookmarked lot survives signing in. The
    // callback refuses anything that is not a same-site path, because an
    // open redirect on a sign-in route is how a phishing page borrows a
    // domain it does not own.
    if (pathname !== "/") signIn.searchParams.set("next", pathname + request.nextUrl.search);
    return NextResponse.redirect(signIn);
  }

  const expected = process.env.GATE_PASSWORD;
  if (!expected) return NextResponse.next();

  const header = request.headers.get("authorization");
  if (!header?.startsWith("Basic ")) return unauthorised();

  let decoded: string;
  try {
    decoded = atob(header.slice("Basic ".length));
  } catch {
    return unauthorised();
  }

  // Split on the FIRST colon only: a password may legitimately contain one, and
  // splitting on all of them silently rejects valid credentials.
  const separator = decoded.indexOf(":");
  if (separator < 0) return unauthorised();
  const user = decoded.slice(0, separator);
  const password = decoded.slice(separator + 1);

  const userOk = safeEqual(user, process.env.GATE_USER ?? "taptap3d");
  const passwordOk = safeEqual(password, expected);
  // Both compared before returning, so the response time does not reveal which
  // half was wrong.
  return userOk && passwordOk ? NextResponse.next() : unauthorised();
}

export const config = {
  matcher: [
    // Everything except Next's own static output and the health endpoint.
    // The health check must stay reachable or the platform will conclude the
    // application is down and keep restarting a container that is working.
    "/((?!_next/static|_next/image|favicon.ico|api/health).*)",
  ],
};
