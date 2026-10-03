// Which address this deployment answers on, as the browser would write it.
//
// ── MEASURED, NOT REASONED ABOUT ───────────────────────────────────────────
//
// `new URL("/sign-in", request.url)` is the obvious way to build a redirect
// out of a route handler, and on the deployed instance it produces
//
//     https://[::]:3000/sign-in?refused=expired
//
// — the server's own BIND address, because `output: "standalone"` listens on
// `::` and a node-runtime handler sees the socket rather than the hostname
// the browser typed. Nothing upstream rewrites a `Location` that is already
// absolute, so the browser is sent to an address that exists on no network.
// Found by curling the deployed callback, not by reading the code: every
// local run and every e2e run has a real host in `request.url` and is green.
//
// `src/proxy.ts` is NOT affected and deliberately keeps `request.url` — the
// proxy runtime sees the external URL, and the proxy may not import shared
// modules anyway (Next's own guidance, and the reason that file duplicates
// the cookie name).
//
// ── WHY THE ENVIRONMENT WINS ───────────────────────────────────────────────
//
// `x-forwarded-*` is attacker-controlled anywhere without a trusted proxy in
// front, and a sign-in redirect is exactly where that matters. On the
// deployed instance `TAPTAP3D_PUBLIC_ORIGIN` is set, so the headers are never
// consulted in production; they are the answer for a machine that has no
// configuration, where the alternative is the bind address.

import type { NextRequest } from "next/server";

/** `https://taptap3d.fly.dev` — scheme and host, never a trailing slash. */
export function publicOrigin(request: NextRequest): string {
  const configured = process.env.TAPTAP3D_PUBLIC_ORIGIN;
  if (configured) return configured.replace(/\/+$/, "");

  const url = new URL(request.url);
  const proto = request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  const host = request.headers.get("x-forwarded-host") ?? url.host;
  return `${proto}://${host}`;
}
