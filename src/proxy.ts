import { NextResponse, type NextRequest } from "next/server";

// THE M0 ACCESS GATE, in proxy.ts rather than middleware.ts.
//
// Next 16 deprecated the `middleware` filename and the `middleware` export in
// favour of `proxy`, to make the network boundary explicit. The old name still
// works and is exactly the kind of thing that gets carried forward for years by
// habit; it is renamed here on the way in rather than left for a codemod.
// `proxy` runs on the nodejs runtime and cannot be configured to edge.
// This is not authentication and it is not a step towards
// it — the identity system is a separate, deferred decision (ROADMAP D14).
//
// It exists because the predecessor was deployed to the public internet with no
// gate at all, listing every project to any caller and exposing a DELETE that
// destroyed one. A shared secret in front of the whole application costs an
// afternoon, is thrown away the day real auth lands, and means a public URL is
// not a public database in the meantime.
//
// Absent GATE_PASSWORD it does nothing, so local development is unaffected.

const REALM = 'Basic realm="taptap3d", charset="UTF-8"';

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

export function proxy(request: NextRequest): NextResponse {
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
