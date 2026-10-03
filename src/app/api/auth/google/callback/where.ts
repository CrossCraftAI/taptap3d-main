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
// The origin half is `publicOrigin` (src/lib/auth/origin.ts), which every
// redirect out of these routes now shares — see its header for what the
// obvious alternative does on the deployed instance.

import type { NextRequest } from "next/server";

import { publicOrigin } from "@/lib/auth/origin";

/** The path half, which is fixed by where the route file lives. */
export const CALLBACK_PATH = "/api/auth/google/callback";

export function redirectUri(request: NextRequest): string {
  return `${publicOrigin(request)}${CALLBACK_PATH}`;
}
