// The session's pure half, and the cookie's options.
//
// The database half is exercised in test/admit.db.test.ts and by driving the
// application; what is here is the part where getting one constant wrong is
// the whole of the vulnerability, and where a node test can say so.

import { describe, expect, it } from "vitest";

import {
  cookieOptions,
  hashToken,
  newToken,
  sameToken,
  SESSION_COOKIE,
} from "@/lib/auth/session";

describe("the token a browser carries", () => {
  it("is 256 bits, so it cannot be guessed or enumerated", () => {
    // base64url of 32 bytes is 43 characters with no padding. Asserted as
    // entropy rather than as a length, because the length is the symptom.
    const token = newToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(new Set(Array.from({ length: 200 }, newToken)).size).toBe(200);
  });

  it("is never what the database holds", () => {
    // THE POINT OF THE COLUMN. A backup, a log line or a stray `select *`
    // must not hand over live sessions for every signed-in person.
    const token = newToken();
    const stored = hashToken(token);
    expect(stored).not.toContain(token);
    expect(stored).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(token)).toBe(stored);
    expect(hashToken(newToken())).not.toBe(stored);
  });

  it("compares in constant time, and says no to a different length", () => {
    const token = newToken();
    expect(sameToken(token, token)).toBe(true);
    expect(sameToken(token, newToken())).toBe(false);
    // `timingSafeEqual` THROWS on mismatched lengths rather than returning
    // false, so the guard above it is load-bearing: without it a shorter
    // `state` parameter would take the callback down instead of refusing.
    expect(sameToken(token, token.slice(0, 10))).toBe(false);
    expect(sameToken("", "")).toBe(true);
  });
});

describe("the cookie's options, where one wrong flag is the whole hole", () => {
  const expires = new Date("2027-01-01T00:00:00Z");

  it("is httpOnly, so script cannot read the session", () => {
    expect(cookieOptions(expires).httpOnly).toBe(true);
  });

  it("is SameSite=Lax, which is what survives the trip back from Google", () => {
    // `strict` would be dropped on the cross-site redirect from Google's
    // consent screen, so the callback would set a session the very next
    // request could not see — a sign-in that silently does nothing. `none`
    // would send it on any cross-site POST, which is CSRF for every action
    // in the product.
    expect(cookieOptions(expires).sameSite).toBe("lax");
  });

  it("is path-wide and carries the expiry it was given", () => {
    expect(cookieOptions(expires).path).toBe("/");
    expect(cookieOptions(expires).expires).toBe(expires);
  });
});

describe("the proxy and the session agree on the cookie's name", () => {
  /**
   * `src/proxy.ts` DUPLICATES this string deliberately — Next's guidance is
   * that proxy code must not rely on shared modules, and importing the
   * session module there would pull the database client into the network
   * boundary. A duplicated constant needs something holding the two copies
   * together, and this is it: if they drift, the proxy redirects a
   * signed-in person to a sign-in page they do not need, forever.
   */
  it("or a signed-in person is redirected to sign in forever", async () => {
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync("src/proxy.ts", "utf8"),
    );
    expect(source).toContain(`const SESSION_COOKIE = "${SESSION_COOKIE}"`);
  });
});
