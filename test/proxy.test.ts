// The front door's three modes, and the paths that must survive all of them.
//
// ── WHY THIS IS WORTH A TEST WHEN IT IS NOT THE ACCESS CONTROL ─────────────
//
// `src/proxy.ts` cannot open the database — Next's own guidance is that proxy
// code must not rely on shared modules — so it can only see whether a session
// COOKIE is present. The real check is in src/lib/data/org.ts, and a forged
// cookie gets past this file and gets nothing.
//
// What this file CAN do wrong is lock everybody out. If it fails to exempt
// /sign-in or /api/auth/*, a signed-out browser is redirected to a page that
// redirects it to a page, forever, and the product is unreachable with no
// error anywhere. That loop is invisible to every other test in the suite,
// because every other test runs with sign-in unconfigured.

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { proxy } from "@/proxy";

const SESSION_COOKIE = "taptap3d_session";

function ask(path: string, cookie?: string): NextRequest {
  const request = new NextRequest(new URL(path, "https://taptap3d.fly.dev"));
  if (cookie) request.cookies.set(SESSION_COOKIE, cookie);
  return request;
}

/** Saved and restored, because these are process-wide and the suite is not. */
const KEYS = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GATE_PASSWORD", "GATE_USER"];
let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
});
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("with sign-in configured", () => {
  beforeEach(() => {
    process.env.GOOGLE_CLIENT_ID = "client";
    process.env.GOOGLE_CLIENT_SECRET = "secret";
  });

  it("lets a browser carrying a session through", () => {
    expect(proxy(ask("/events/abc", "whatever")).status).toBe(200);
  });

  it("sends a browser with no session to sign in", () => {
    const response = proxy(ask("/events/abc"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/sign-in");
  });

  /**
   * THE REDIRECT LOOP THIS FILE EXISTS TO PREVENT. Without the exemption a
   * signed-out browser is sent to /sign-in, which is itself signed out, which
   * sends it to /sign-in — and the product is unreachable with nothing in any
   * log saying why.
   */
  it("and never redirects the sign-in page or the Google round trip", () => {
    for (const path of [
      "/sign-in",
      "/api/auth/google/start",
      "/api/auth/google/callback?code=x&state=y",
      "/api/auth/signout",
    ]) {
      expect(proxy(ask(path)).status, `${path} was redirected`).toBe(200);
    }
  });

  it("carries where they were going, so a bookmarked lot survives signing in", () => {
    const location = proxy(ask("/events/abc/lots/def")).headers.get("location") ?? "";
    expect(new URL(location).searchParams.get("next")).toBe("/events/abc/lots/def");
    // Not for the root: "next=/" is noise in a URL a person may look at.
    const home = proxy(ask("/")).headers.get("location") ?? "";
    expect(new URL(home).searchParams.get("next")).toBeNull();
  });

  it("ignores the shared gate entirely, rather than asking for both", () => {
    // Sign-in REPLACED the password; a deployment that had both set would
    // otherwise show a browser credential box in front of the sign-in page,
    // which is the first thing a prospect would see.
    process.env.GATE_PASSWORD = "still-set";
    expect(proxy(ask("/sign-in")).status).toBe(200);
    expect(proxy(ask("/events/abc")).headers.get("location")).toContain("/sign-in");
  });
});

describe("with no sign-in configured", () => {
  it("falls back to the shared gate when one is set", () => {
    // A staging box with no Google project must still not be a public
    // database — the reason the gate was written in the first place.
    process.env.GATE_PASSWORD = "shared";
    expect(proxy(ask("/events/abc")).status).toBe(401);
    expect(proxy(ask("/sign-in")).status).toBe(401);
  });

  it("admits the correct shared credentials", () => {
    process.env.GATE_PASSWORD = "shared";
    const request = ask("/events/abc");
    request.headers.set("authorization", `Basic ${btoa("taptap3d:shared")}`);
    expect(proxy(request).status).toBe(200);
  });

  it("and does nothing at all when neither is set", () => {
    // Every developer machine and every end-to-end run is this case. If this
    // ever starts redirecting, the whole browser suite fails at once with a
    // message about signing in.
    expect(proxy(ask("/events/abc")).status).toBe(200);
    expect(proxy(ask("/")).status).toBe(200);
  });
});
