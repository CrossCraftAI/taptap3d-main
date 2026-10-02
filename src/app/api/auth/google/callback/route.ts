// Google sent the browser back. Decide whether to let it in.
//
// ── THE ORDER OF THE CHECKS IS THE SECURITY ────────────────────────────────
//
//   1. state matches the cookie        — or this is a CSRF login, and the
//                                        code is not exchanged at all
//   2. Google says who it is           — over TLS, server to server
//   3. the address is verified         — Google's own word
//   4. a membership row exists         — this product's own answer
//   5. only then is a session written
//
// Nothing between 1 and 4 writes anything, so a refused sign-in leaves no
// trace to clean up and no half-made account for the next attempt to find.
//
// ── WHAT THE BROWSER IS TOLD, AND WHAT THE LOG IS TOLD ─────────────────────
//
// The person gets one sentence and a way back. The reason goes to the server
// log, because "registrar@house.hk has no account here" on a public page is
// an oracle for which addresses exist — and because a person who was refused
// cannot fix it themselves anyway. They need to ask the house, which is what
// the page says.

import { NextResponse, type NextRequest } from "next/server";

import { admit } from "@/lib/auth/admit";
import { GoogleError, identityFromCode } from "@/lib/auth/google";
import {
  authConfigured,
  cookieOptions,
  openSession,
  sameToken,
  SESSION_COOKIE,
  STATE_COOKIE,
} from "@/lib/auth/session";

import { redirectUri } from "./where";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Back to the sign-in page, saying only which of the four things went wrong. */
function refuse(request: NextRequest, code: string, detail: string): NextResponse {
  console.warn(`sign-in refused (${code}): ${detail}`);
  const back = new URL("/sign-in", request.url);
  back.searchParams.set("refused", code);
  const response = NextResponse.redirect(back);
  response.cookies.delete({ name: STATE_COOKIE, path: "/api/auth" });
  return response;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!authConfigured()) {
    return NextResponse.json(
      { error: "Sign-in is not configured on this deployment." },
      { status: 503 },
    );
  }

  const params = request.nextUrl.searchParams;
  // Google's own refusal — the person pressed Cancel, or the app is not
  // approved. Not an error on our side and not logged as one.
  const denied = params.get("error");
  if (denied) return refuse(request, "cancelled", `Google returned ${denied}`);

  const code = params.get("code");
  const state = params.get("state");
  const expected = request.cookies.get(STATE_COOKIE)?.value;
  if (!code || !state || !expected || !sameToken(state, expected)) {
    // ONE BRANCH FOR ALL FOUR, deliberately: a missing state and a wrong one
    // are the same event from the outside, and distinguishing them in the
    // response tells an attacker which half of the forgery worked.
    return refuse(request, "expired", "state missing or did not match the cookie");
  }

  let identity;
  try {
    identity = await identityFromCode(code, redirectUri(request));
  } catch (error) {
    if (error instanceof GoogleError) return refuse(request, "google", error.message);
    throw error;
  }

  const admitted = await admit(identity);
  if (!admitted.ok) return refuse(request, "not-a-member", admitted.reason);

  const { token, expiresAt } = await openSession(admitted.userId);
  // WHERE THEY WERE GOING, and only if it is somewhere on this site: an
  // open redirect here would let a phishing page borrow this domain's
  // sign-in to bounce somebody anywhere.
  const wanted = params.get("next");
  const destination =
    wanted && wanted.startsWith("/") && !wanted.startsWith("//") ? wanted : "/";
  const response = NextResponse.redirect(new URL(destination, request.url));
  response.cookies.set(SESSION_COOKIE, token, cookieOptions(expiresAt));
  response.cookies.delete({ name: STATE_COOKIE, path: "/api/auth" });
  return response;
}
