// No `server-only` import, for the reason src/lib/auth/session.ts gives: the
// client secret is read from `process.env` and this module is reached only
// from route handlers. Adding a dependency to restate that is not worth it.

// Google, as two HTTP calls and no SDK.
//
// ── WHY THE USERINFO ENDPOINT AND NOT THE ID TOKEN ─────────────────────────
//
// The token response carries an `id_token`, which is a JWT. Verifying one
// properly means fetching Google's JWKS, matching the key id, checking the
// signature, the issuer, the audience and the expiry — and every one of those
// is a step that can be skipped by accident, which is how "we decoded the JWT
// and trusted it" becomes a login bypass.
//
// So this does not verify a token at all. It exchanges the code over TLS
// directly with Google, gets an access token, and asks Google who it belongs
// to over TLS directly with Google. The trust comes from the transport and
// the client secret, both of which are checkable by looking at this file.
// It costs one extra round trip per sign-in, which happens once a fortnight
// per person.
//
// ── AND WHY THERE IS NO SDK ────────────────────────────────────────────────
//
// `googleapis` is megabytes of generated surface for two POSTs, and the
// standalone build traces every one of them into the image. The whole
// protocol this product uses is below and fits on a screen.

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const USERINFO_ENDPOINT = "https://openidconnect.googleapis.com/v1/userinfo";

/** What Google is asked for: who they are, and nothing else. */
const SCOPES = ["openid", "email", "profile"];

export class GoogleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoogleError";
  }
}

/**
 * Where the browser is sent to sign in.
 *
 * `state` is CSRF protection and is not optional: without it, an attacker can
 * hand somebody a callback URL carrying the attacker's own code and sign the
 * victim's browser into the attacker's account. It is compared against a
 * cookie before the code is exchanged.
 *
 * `prompt=select_account` because a specialist on a shared machine, or anyone
 * with two Google accounts, otherwise gets silently signed in as whoever the
 * browser last used — and on this product that is a different house's data.
 */
export function authoriseUrl(redirectUri: string, state: string): string {
  const url = new URL(AUTH_ENDPOINT);
  url.searchParams.set("client_id", process.env.GOOGLE_CLIENT_ID ?? "");
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPES.join(" "));
  url.searchParams.set("state", state);
  url.searchParams.set("prompt", "select_account");
  return url.toString();
}

export interface GoogleIdentity {
  /** Stable for the life of the account. What a session is bound to. */
  sub: string;
  email: string;
  /** Google's own word on whether the address is proven. */
  emailVerified: boolean;
  name: string | null;
}

/**
 * Turn the code Google sent back into a person.
 *
 * THROWS RATHER THAN RETURNING NULL on every failure, because there is
 * nothing a caller can usefully do with a half-answer here and a null that
 * gets ignored is a sign-in that succeeds as nobody.
 */
export async function identityFromCode(
  code: string,
  redirectUri: string,
): Promise<GoogleIdentity> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new GoogleError("Sign-in is not configured.");

  const exchanged = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
    // A sign-in that hangs is a sign-in that looks broken. Google answers in
    // well under this; the number exists so a network fault fails fast.
    signal: AbortSignal.timeout(15_000),
  });
  if (!exchanged.ok) {
    // The body carries Google's own reason and NOT the client secret — the
    // secret is in the request, never in the response — so it is safe to
    // surface to a log. It is not surfaced to the browser; see the route.
    throw new GoogleError(
      `Google refused the sign-in (${exchanged.status}): ${await exchanged.text()}`,
    );
  }
  const token = (await exchanged.json()) as { access_token?: unknown };
  if (typeof token.access_token !== "string") {
    throw new GoogleError("Google's answer carried no access token.");
  }

  const who = await fetch(USERINFO_ENDPOINT, {
    headers: { authorization: `Bearer ${token.access_token}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!who.ok) throw new GoogleError(`Google would not say who signed in (${who.status}).`);
  const profile = (await who.json()) as {
    sub?: unknown;
    email?: unknown;
    email_verified?: unknown;
    name?: unknown;
  };
  if (typeof profile.sub !== "string" || typeof profile.email !== "string") {
    throw new GoogleError("Google's answer carried no account.");
  }
  return {
    sub: profile.sub,
    // LOWERCASED HERE, once. An invitation typed as `Registrar@House.HK` and
    // a Google account of `registrar@house.hk` are the same person, and the
    // membership lookup is an equality test.
    email: profile.email.toLowerCase(),
    emailVerified: profile.email_verified === true,
    name: typeof profile.name === "string" ? profile.name : null,
  };
}
