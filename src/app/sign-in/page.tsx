import type { Route } from "next";
import { redirect } from "next/navigation";

import { authConfigured, currentSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/**
 * Why a sign-in was refused, in the second person and without an oracle.
 *
 * ── WHAT IS DELIBERATELY NOT SAID ─────────────────────────────────────────
 *
 * `not-a-member` covers three different server-side facts: no user row, no
 * membership, and an address Google has not verified. A page that told them
 * apart would answer "does registrar@house.hk have an account here" for
 * anybody who asked, which is a list of a client's staff. The reason is in
 * the server log, where the house can be told it.
 *
 * And every one of them has the same remedy anyway: ask the house to add you.
 * A message that is more precise and not more actionable is worse.
 */
const REFUSALS: Readonly<Record<string, string>> = {
  cancelled: "Sign-in was cancelled. Nothing happened.",
  expired:
    "That sign-in took too long, or was started somewhere else. Try again from this page.",
  google: "Google could not complete the sign-in. Try again in a moment.",
  "not-a-member":
    "That account cannot open this house. Ask whoever runs your taptap3d to add your address, then sign in again.",
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ refused?: string; next?: string }>;
}): Promise<React.ReactElement> {
  const { refused, next } = await searchParams;

  // ALREADY IN. A signed-in person reaching this page followed a stale link
  // or pressed Back past the callback; showing them a sign-in button would
  // suggest they are not signed in when they are.
  if (await currentSession()) redirect("/");

  const start = next
    ? (`/api/auth/google/start?next=${encodeURIComponent(next)}` as Route)
    : ("/api/auth/google/start" as Route);

  return (
    <main className="flex min-h-dvh items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm">
        <h1 className="text-[16px] font-semibold tracking-[-0.01em]">
          taptap<span className="text-seal">3d</span>
        </h1>
        <p className="mt-1 text-[13px] leading-relaxed text-muted">
          Catalogue production for auction houses.
        </p>

        {refused && (
          <p
            role="alert"
            className="mt-6 border-l-2 border-seal bg-sealSoft px-4 py-2 text-[13px] leading-relaxed text-ink"
          >
            {REFUSALS[refused] ?? REFUSALS["google"]}
          </p>
        )}

        {authConfigured() ? (
          <>
            {/* A FORM AND NOT A LINK, so the browser does not prefetch it.
                Next prefetches links in view, and a prefetched start route
                would set a `state` cookie for a sign-in nobody began — and
                then overwrite it when they actually pressed. */}
            <form action={start} method="GET" className="mt-6">
              {next && <input type="hidden" name="next" value={next} />}
              <button
                type="submit"
                className="flex min-h-[var(--tap)] w-full items-center justify-center border border-ruleStrong bg-paper px-4 text-[13px] font-medium hover:bg-sunk"
              >
                Sign in with Google
              </button>
            </form>
            <p className="mt-4 text-[12px] leading-relaxed text-faint">
              {/* SAYS WHO MAY GET IN, because the commonest refusal is a
                  person using the wrong one of their two Google accounts and
                  there is nothing on a Google screen to warn them. */}
              Use the address your house invited. Google is asked for your name
              and email address and nothing else.
            </p>
          </>
        ) : (
          <p className="mt-6 border border-rule bg-field px-4 py-3 text-[13px] leading-relaxed text-muted">
            Sign-in is not configured on this deployment. It needs
            GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET; until then the
            application is reached directly.
          </p>
        )}
      </div>
    </main>
  );
}
