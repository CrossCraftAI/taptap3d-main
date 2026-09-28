import { PageHeader } from "@/components/page-header";
import { currentOrgOrNull, fieldPolicyOf, listFieldKeys } from "@/lib/data/org";
import { policyRows } from "@/lib/settings";

import { FieldPolicyForm } from "./field-policy-form";

export const dynamic = "force-dynamic";

/**
 * The house's own settings.
 *
 * ── ONE SETTING, AND THE SCREEN SAYS WHICH ──────────────────────────────────
 *
 * There is exactly one thing a house can set today: which of its fields may
 * leave the building. A hub page listing one link to it would be a door in
 * front of a door, so this screen IS that setting, under the heading the rail
 * points at. It grows a second section the day there is a second thing, and
 * nothing here has to move for that.
 *
 * ── WHY IT IS A HOUSE-LEVEL SCREEN AND NOT A CONTROL ON A LOT ───────────────
 *
 * `orgs.field_policy` is per-org by construction, and the reasoning is in
 * src/lib/engine/visibility.ts: a level per (lot, field) would make every
 * newly imported lot's reserve public until somebody remembered, which is the
 * one direction this must never fail in. The consequence for the interface is
 * the thing this page has to be honest about — a tick beside the reserve on
 * ONE lot's record would silently change every lot in every sale, and a
 * control that does something that much larger than it looks is worse than no
 * control. So it is here, where its scope is, and the first sentence a reader
 * meets says so.
 *
 * ── IT RENDERS WITHOUT AN ORG ───────────────────────────────────────────────
 *
 * `currentOrgOrNull`, the way /photographs does. A settings screen that threw
 * on a machine nobody has seeded would be a blank page with no way to find out
 * why, which is the failure `currentOrgOrNull` exists for.
 */
export default async function SettingsPage(): Promise<React.ReactElement> {
  const org = await currentOrgOrNull();
  if (!org) {
    return (
      <div className="mx-auto max-w-lg px-8 py-20">
        <h1 className="text-[16px] font-semibold">Settings</h1>
        {/* The state, and no shell command — see the note on the same screen
            in src/app/page.tsx. */}
        <p className="mt-2 text-[13px] leading-relaxed text-muted">
          There is no house set up on this installation yet.
        </p>
      </div>
    );
  }

  const [policy, discovered] = await Promise.all([
    fieldPolicyOf(org.id),
    listFieldKeys(org.id),
  ]);
  const view = policyRows(policy, discovered);

  return (
    <div className="px-8 py-8">
      <PageHeader
        title="Settings"
        meta={
          view.marked === 0
            ? `${org.name} · no field is held back`
            : `${org.name} · ${view.marked} of ${view.all.length} fields held back`
        }
      />

      <section className="mt-6 border border-rule bg-paper">
        <div className="border-b border-rule px-4 py-2.5">
          <h2 className="text-[13px] font-medium">What may leave the building</h2>
          {/* THE SCOPE, IN THE FIRST SENTENCE AND NOT IN A FOOTNOTE. This is
              the one thing about this screen a person can get catastrophically
              wrong, and the mistake it prevents — reading a row as being about
              the sale on screen — is the mistake anybody arriving from a lot
              record would make. */}
          <p className="mt-1 max-w-prose text-[12px] leading-relaxed text-muted">
            These answers belong to the whole house. One level per field, used
            by every catalogue of every sale, now and in future — there is no
            per-lot and no per-sale version of this, on purpose, because a
            reserve is a reserve on every lot and a field that had to be marked
            again for each one would be public until somebody remembered.
          </p>
          <p className="mt-1.5 max-w-prose text-[12px] leading-relaxed text-faint">
            An output carries only the values its readership may have; the
            rest never reach the page. A field nobody has marked is public,
            which is what every field is until this screen is used — so leaving
            a row alone changes nothing at all.
          </p>
        </div>

        <FieldPolicyForm view={view} version={org.updatedAt.getTime()} />
      </section>

      <p className="mt-4 max-w-prose text-[12px] leading-relaxed text-faint">
        {/* WHERE THE OTHER HALF OF THIS LIVES. The level is the house's answer
            about a field; what ONE catalogue prints is that catalogue's own
            decision, and the two are different controls in different places.
            Naming the other one here is what stops somebody coming to this
            screen to hide a maker on a single page. */}
        Hiding a field in one catalogue only is a different decision and it is
        made on the lot, in the catalogue panel of its record. This screen is
        the house&rsquo;s standing answer; that one is a sale&rsquo;s.
      </p>
    </div>
  );
}
