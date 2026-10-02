// The one string Google and this application must agree on, character for
// character.
//
// ── WHY IT IS DERIVED AND NOT CONFIGURED ───────────────────────────────────
//
// Google compares `redirect_uri` on the authorise call and again on the token
// exchange, and a mismatch of a trailing slash or a scheme is `redirect_uri_
// mismatch` — the single most common way a Google sign-in fails, and it fails
// with a message that names neither value. Computing it in one function used
// by both calls removes the only way the two can disagree with each other.
//
// ── AND WHY THE HOST COMES FROM A HEADER, CAREFULLY ────────────────────────
//
// Fly terminates TLS and forwards http, so `request.url` says `http://` and
// an origin taken from it would be a redirect URI Google has never been told
// about. `x-forwarded-proto` is the right answer there and is attacker-
// controlled anywhere without a trusted proxy in front — which is why the
// environment wins when it is set. On the deployed instance it IS set, so the
// header is never consulted in production.

import type { NextRequest } from "next/server";

/** The path half, which is fixed by where the route file lives. */
export const CALLBACK_PATH = "/api/auth/google/callback";

export function redirectUri(request: NextRequest): string {
  const configured = process.env.TAPTAP3D_PUBLIC_ORIGIN;
  if (configured) return `${configured.replace(/\/+$/, "")}${CALLBACK_PATH}`;

  const url = new URL(request.url);
  const proto = request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  const host = request.headers.get("x-forwarded-host") ?? url.host;
  return `${proto}://${host}${CALLBACK_PATH}`;
}
