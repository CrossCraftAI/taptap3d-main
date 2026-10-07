"use client";

import { usePathname } from "next/navigation";

import { Brand } from "@/components/brand";
import { HousePicker } from "@/components/house-picker";
import { Switcher, type SwitcherItem } from "@/components/switcher";
import type { EventChoice } from "@/lib/data/events";
import { openEventId, switchEvent } from "@/lib/nav";

export function TopBar({
  org,
  houses = [],
  currentOrgId = null,
  events,
  signedIn = null,
}: {
  /** The acting house, or null when none has resolved. */
  org: string | null;
  houses?: readonly { id: string; name: string }[];
  currentOrgId?: string | null;
  events: readonly EventChoice[];
  /**
   * The person, when there is one. Null on a deployment with no sign-in
   * configured, which is every developer machine and every e2e run.
   */
  signedIn?: { name: string | null; email: string } | null;
}): React.ReactElement {
  const pathname = usePathname();
  const openId = openEventId(pathname);

  const items: SwitcherItem[] = events.map((event) => ({
    id: event.id,
    name: event.name,
    note: subtitle(event),
    href: switchEvent(pathname, event.id),
  }));

  return (
    // pl-9 clears the rail toggle, which is fixed in the window's corner and
    // stays there whether this bar is showing or not (see shell.tsx: one
    // button, one place, one element).
    //
    // NOT `overflow-hidden`, however tempting on a row that may not wrap: the
    // switcher's menu is positioned against this row and clipping here removes
    // it entirely. Long names are held by `truncate` on each part instead, and
    // the shell's own root is what stops anything reaching a scrollbar.
    <div className="flex h-[38px] items-center gap-3 border-b border-rule bg-paper pl-9 pr-3">
      <Brand className="shrink-0 text-[15px] text-ink" />

      {/* ── THE CRUMBS FOLLOW THE APP'S OWN BOUNDARY ────────────────────────
          Below the window this product says it needs, `main` is a sentence and
          the rail is gone — so there is nothing to navigate, and a switcher
          over a screen that is not rendering is chrome for nothing. The
          inspection loop found it as the last two clip warnings on the whole
          product: at 320 the house's name and the switcher's "All events" were
          each cut to about two thirds, because three names and a wordmark do
          not fit in 320 pixels and never will.

          The wordmark stays. It is the one thing worth saying on a screen
          whose whole message is "not here" — it tells the reader what refused
          them. `too-small` is defined once in src/app/globals.css, beside the
          reason. */}
      <div className="flex min-w-0 items-center gap-3 too-small:hidden">
      {/* The house list contains the signed-in person's memberships only. */}
      <span aria-hidden="true" className="shrink-0 text-ruleStrong">
        /
      </span>
      {houses.length > 1 ? <HousePicker houses={houses} currentId={currentOrgId} /> : <span className="min-w-0 max-w-[16rem] truncate text-[13px] text-muted">{org ?? "No organisation"}</span>}

      {/* THE SALE. Not rendered at all when the house has no sales: a switcher
          over nothing is a control that cannot do the one thing it offers, and
          the ledger's own empty state is already saying what to do instead. */}
      {events.length > 0 && (
        <>
          <span aria-hidden="true" className="shrink-0 text-ruleStrong">
            /
          </span>
          <Switcher
            axis="event"
            items={items}
            currentId={openId}
            all={{ href: "/", label: "All events" }}
            // "NEW EVENT…", NOT "NEW SALE…", which is what the drawing calls
            // it. The chrome's own word for this noun is `event` — the row
            // above it says "All events", the ledger's field says "Name a new
            // event" and its button says "Create event" — and two words for
            // one thing inside one menu is exactly what the drawing's
            // vocabulary select was rejected for (see above). The day that
            // select ships, both labels change together.
            //
            // IT LINKS TO THE LEDGER rather than creating anything. The
            // ledger's quick-add IS the first line of that screen, so the
            // sentence below is the whole instruction; a second field here
            // would be `createEventAction` driven from two places. What it
            // cannot do from out here is put the cursor in that field — the
            // field belongs to the ledger, the chrome does not reach into the
            // page to focus things, and giving it an anchor is the ledger's
            // change to make, not this one's.
            create={{
              href: "/",
              label: "New event…",
              note: "Name it on the ledger's first line.",
            }}
          />
        </>
      )}
      </div>

      {/* ── WHO IS SIGNED IN, AND THE WAY OUT ───────────────────────────────
          At the far right, which is where every product this trade's staff
          already use puts it, and hidden below the window the product says it
          needs for the reason the crumbs beside it are.

          NOTHING AT ALL WHEN NOBODY IS SIGNED IN, rather than a "Sign in"
          link: on a deployment with no Google project there is nobody to sign
          in as, and on one with a project the signed-out browser never gets
          this far — src/proxy.ts sends it to /sign-in before a layout runs.

          A FORM POSTING TO A ROUTE, not a link. A GET that ends a session is
          a session anybody can end from an <img> on another site, and Next
          would prefetch a link to it. */}
      {signedIn && (
        <div className="ml-auto flex min-w-0 items-center gap-2 too-small:hidden">
          <span
            className="min-w-0 max-w-[14rem] truncate text-[12px] text-faint"
            title={signedIn.email}
          >
            {signedIn.name ?? signedIn.email}
          </span>
          <form action="/api/auth/signout" method="POST">
            <button
              type="submit"
              className="inline-flex min-h-[var(--tap)] items-center px-2 text-[12px] text-muted hover:text-ink"
            >
              Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

/**
 * The second line of a menu row: whatever tells two similarly named sales
 * apart. Two of them are called "Spring Sale" and the date is the difference.
 *
 * Formatted with an explicit locale and time zone, which is what makes it safe
 * in a client component: the server and the browser produce the same string,
 * so hydration has nothing to reconcile. The catalogue is produced in Hong
 * Kong and a server in another zone must not shift a sale by a day.
 */
function subtitle(event: EventChoice): string {
  const parts: string[] = [];
  if (event.heldOn) {
    parts.push(
      new Intl.DateTimeFormat("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        timeZone: "Asia/Hong_Kong",
      }).format(event.heldOn),
    );
  }
  parts.push(
    event.lotCount === 1 ? "1 lot" : `${event.lotCount} lots`,
  );
  return parts.join(" · ");
}
