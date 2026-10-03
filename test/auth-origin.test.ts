// Where a sign-in redirect points, which is not where the code said it did.
//
// ── THE DEFECT THIS FILE EXISTS FOR ────────────────────────────────────────
//
// Both auth routes built their redirects with `new URL(path, request.url)`,
// and on the deployed instance that produced `https://[::]:3000/sign-in` —
// the standalone server's bind address. Every refusal AND every successful
// sign-in landed on an address that exists on no network. It was green
// locally and green in e2e, because in both of those `request.url` carries a
// real host; only a curl against Fly could see it.
//
// So the assertion that matters is not "the path is right". It is that the
// HOST is the one a browser typed, with a request whose own url is the bind
// address — the shape the deployed instance actually has.

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET as callback } from "@/app/api/auth/google/callback/route";
import { CALLBACK_PATH, redirectUri } from "@/app/api/auth/google/callback/where";
import { POST as signOut } from "@/app/api/auth/signout/route";
import { publicOrigin } from "@/lib/auth/origin";

/** A request as the node runtime sees it behind Fly's proxy. */
function behindFly(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(new URL("/api/auth/google/callback", "https://[::]:3000"), {
    headers,
  });
}

let saved: string | undefined;
beforeEach(() => {
  saved = process.env.TAPTAP3D_PUBLIC_ORIGIN;
  delete process.env.TAPTAP3D_PUBLIC_ORIGIN;
});
afterEach(() => {
  if (saved === undefined) delete process.env.TAPTAP3D_PUBLIC_ORIGIN;
  else process.env.TAPTAP3D_PUBLIC_ORIGIN = saved;
});

describe("the origin a redirect is built on", () => {
  it("is the configured one, and never the socket the server listens on", () => {
    process.env.TAPTAP3D_PUBLIC_ORIGIN = "https://taptap3d.fly.dev";
    expect(publicOrigin(behindFly())).toBe("https://taptap3d.fly.dev");
  });

  it("tolerates a trailing slash somebody put in the environment", () => {
    process.env.TAPTAP3D_PUBLIC_ORIGIN = "https://taptap3d.fly.dev/";
    expect(publicOrigin(behindFly())).toBe("https://taptap3d.fly.dev");
  });

  it("falls back to the forwarded headers when nothing is configured", () => {
    // Attacker-controlled without a trusted proxy, which is why the
    // environment wins above — but better than the bind address.
    const request = behindFly({
      "x-forwarded-proto": "https",
      "x-forwarded-host": "catalogue.house.hk",
    });
    expect(publicOrigin(request)).toBe("https://catalogue.house.hk");
  });
});

describe("the two strings Google compares", () => {
  it("is the public origin plus the path the route file sits at", () => {
    process.env.TAPTAP3D_PUBLIC_ORIGIN = "https://taptap3d.fly.dev";
    expect(redirectUri(behindFly())).toBe(`https://taptap3d.fly.dev${CALLBACK_PATH}`);
  });

});

/**
 * THE ROUTES THEMSELVES, because the defect was never in the helper — it was
 * in two call sites that each built their own URL, and a test of the helper
 * alone would have stayed green through all of it.
 *
 * Both drive the branch that reaches a redirect without touching the
 * database: a callback with no `code` is refused before anything is read,
 * and a sign-out with no cookie closes nothing.
 */
describe("what the browser is actually told", () => {
  const KEYS = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"];
  let keys: Record<string, string | undefined> = {};

  beforeEach(() => {
    keys = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
    process.env.GOOGLE_CLIENT_ID = "client";
    process.env.GOOGLE_CLIENT_SECRET = "secret";
    process.env.TAPTAP3D_PUBLIC_ORIGIN = "https://taptap3d.fly.dev";
    // The refusal is logged on purpose; the suite's output is not the place.
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    for (const k of KEYS) {
      if (keys[k] === undefined) delete process.env[k];
      else process.env[k] = keys[k]!;
    }
    vi.restoreAllMocks();
  });

  it("sends a refused sign-in back to a host that exists", async () => {
    const response = await callback(behindFly());
    expect(response.headers.get("location")).toBe(
      "https://taptap3d.fly.dev/sign-in?refused=expired",
    );
  });

  it("and sends a sign-out to the same place", async () => {
    const request = new NextRequest(new URL("/api/auth/signout", "https://[::]:3000"), {
      method: "POST",
    });
    const response = await signOut(request);
    expect(response.headers.get("location")).toBe("https://taptap3d.fly.dev/sign-in");
  });
});
