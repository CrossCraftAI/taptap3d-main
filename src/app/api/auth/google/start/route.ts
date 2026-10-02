// Send the browser to Google.
//
// A ROUTE AND NOT A LINK IN THE PAGE, because the `state` parameter has to be
// generated per attempt and written to a cookie in the same response that
// redirects — which a server component cannot do (Next's own note: setting a
// cookie is not supported during render). A link with a state baked into the
// HTML would also be a state cached by whatever sits in front of this.

import { NextResponse, type NextRequest } from "next/server";

import { authoriseUrl } from "@/lib/auth/google";
import {
  authConfigured,
  cookieOptions,
  newToken,
  STATE_COOKIE,
} from "@/lib/auth/session";
import { redirectUri } from "../callback/where";

export const runtime = "nodejs";
/** Never cached: every attempt needs its own `state`. */
export const dynamic = "force-dynamic";

export function GET(request: NextRequest): NextResponse {
  if (!authConfigured()) {
    return NextResponse.json(
      { error: "Sign-in is not configured on this deployment." },
      { status: 503 },
    );
  }

  const state = newToken();
  const response = NextResponse.redirect(authoriseUrl(redirectUri(request), state));
  // TEN MINUTES, not the session's fortnight. It exists only to survive one
  // redirect out and back; a long-lived state cookie is a replayable one.
  response.cookies.set(STATE_COOKIE, state, {
    ...cookieOptions(new Date(Date.now() + 10 * 60 * 1000)),
    // The callback is the only thing that reads it.
    path: "/api/auth",
  });
  return response;
}
