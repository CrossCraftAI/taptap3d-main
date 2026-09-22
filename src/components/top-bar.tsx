"use client";

import { usePathname } from "next/navigation";

import { Switcher, type SwitcherItem } from "@/components/switcher";
import type { EventChoice } from "@/lib/data/events";
import { openEventId, switchEvent } from "@/lib/nav";

/**
 * The strip across the top: who you are working for, and which of their sales
 * is open.
 *
 * ── WHAT IS HERE AND WHAT IS NOT ────────────────────────────────────────────
 *
 * The drawing put five more things on this row — a workspace nav (Projects,
 * Records, Workflows, Storefront, Admin), a vocabulary select, a design-notes
 * toggle and a Download PDF. None of them ship:
 *
 *   - The WORKSPACE NAV is a second navigation axis, and this product has one.
 *     Three of its five entries have no page at all and two of them fell
 *     through to the ledger in the drawing itself; the other two would be the
 *     rail's own places written twice, which is two controls for one job and
 *     two places to be wrong about where you are.
 *   - The VOCABULARY select relabels the whole interface per tenant. It is
 *     Phase 10 and it is not started; a select that relabels nothing is a
 *     control that lies.
 *   - DESIGN NOTES is an annotation layer belonging to the drawing.
 *   - DOWNLOAD PDF is real here, unlike in the drawing — but it is a property
 *     of one document, not of the application, and it already sits on the
 *     editor's header, on the exports ledger and in the palette's Document
 *     panel. A fourth copy on every screen would have to answer "which sale?"
 *     and the top bar is the wrong place to ask.
 *
 * ── THE TENANCY SEAM: WHERE THE ORG SWITCHER GOES ───────────────────────────
 *
 * The house's name is rendered below as TEXT, immediately before the event
 * switcher. That position is the org switcher's seat and the second axis is a
 * second `<Switcher>` there, taking orgs where the one below takes events —
 * the component knows no nouns, so adding the axis is data and a query.
 *
 * It cannot be built yet, and the list of what has to be true first is short
 * and exact:
 *
 *   1. AN IDENTITY (ROADMAP D14). Until a request carries a person, "which
 *      orgs may I switch to" has no answer; a switcher over every row of
 *      `orgs` is an admin tool for anyone who reaches the URL.
 *   2. A MEMBERSHIP table — person × org — because the menu's items are that
 *      table, not the org table.
 *   3. `currentOrgId()` (src/lib/data/org.ts) must stop REFUSING when more
 *      than one org exists and start reading the session. It refuses today on
 *      purpose: a silent "pick the first" works perfectly on a one-tenant
 *      machine and mixes two customers' data the first time it does not. That
 *      throw is the thing that has to change, and nothing else below it does
 *      — every data function already takes `orgId` as its first argument.
 *   4. `TAPTAP3D_ORG_SLUG` comes out of fly.toml. It pins the deployment to
 *      one tenant, which is exactly right while there is no sign-in and
 *      exactly wrong once there is.
 *
 * Note what is NOT on that list: nothing in this component, and no constant
 * anywhere. The org arrives as a prop resolved per request
 * (`currentOrgOrNull`), so a second one changes what is passed in, not what is
 * written down.
 */
export function TopBar({
  org,
  events,
}: {
  /** The acting house, or null when none has resolved. */
  org: string | null;
  events: readonly EventChoice[];
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
      <p className="shrink-0 text-[15px] font-semibold tracking-tight">
        taptap<span className="text-seal">3d</span>
      </p>

      {/* THE HOUSE. Text today, the org switcher's seat tomorrow — see above. */}
      <span aria-hidden="true" className="shrink-0 text-ruleStrong">
        /
      </span>
      <span
        className="min-w-0 max-w-[16rem] truncate text-[13px] text-muted"
        title={org ? `${org} — the organisation every row here belongs to` : undefined}
      >
        {org ?? "No organisation"}
      </span>

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
          />
        </>
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
