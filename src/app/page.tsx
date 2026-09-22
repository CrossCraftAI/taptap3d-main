import { Ledger } from "@/components/ledger";
import { PageHeader } from "@/components/page-header";
import { listEvents } from "@/lib/data/events";
import { currentOrgOrNull } from "@/lib/data/org";
import { workflowOf } from "@/lib/data/workflow";
import { readLedger, readQuery } from "@/lib/ledger";

export const dynamic = "force-dynamic";

/**
 * The ledger — one screen for every sale this house has.
 *
 * ── PROGRESS IS A COLUMN, NOT A BAR ─────────────────────────────────────────
 *
 * Where a sale is in production and what to do about it next are two of this
 * table's four columns, beside the counts they are read from. A progress bar
 * across the top of the editor was considered and rejected: it would cost every
 * screen vertical space to say something about one sale, and the person who
 * needs the answer is here, comparing sixty. The stage and the button come from
 * the workflow (src/lib/workflow.ts) and this page knows none of its names.
 *
 * The column REPORTS. Nothing in a row is disabled or hidden because of it —
 * the sale that comes back round after the export reads as a sale with work
 * outstanding, which is what it is (DFD.md §1: a cycle, not a pipeline).
 *
 * ── ONE LEDGER, NOT THREE ───────────────────────────────────────────────────
 *
 * `/catalogues` and `/exports` were this table with a different verb in the
 * last column — same query, same component, three headings — and they are gone.
 * The verb belongs to the sale, not to the screen: src/lib/ledger.ts holds that
 * argument, and src/lib/nav.ts said the same thing about the rail before either
 * page existed.
 *
 * ── THE VIEW IS THE URL ─────────────────────────────────────────────────────
 *
 * Search, stage and page are read from the query string and nothing else, so
 * the whole screen is a pure function of an address: a link to "the sales still
 * being photographed" is a link somebody can send, and the back button means
 * what it says. It renders on the server for the same reason — there is no
 * state here a browser has to hold — and this route was already
 * `force-dynamic`, so the request-time read costs nothing new.
 *
 * The default is OPEN sales, not all of them. An exported sale is archive: it
 * is findable, by name or by its own tab, and it is not what somebody came here
 * to work on. Before this, the landing rendered every sale an org has in one
 * table — measured at some 21,000px of page for 250 of them — with no search
 * and no way to skip to a sale whose name you already know.
 */
export default async function LedgerPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.ReactElement> {
  const org = await currentOrgOrNull();

  if (!org) {
    return (
      <div className="mx-auto max-w-lg px-8 py-20">
        <h1 className="text-[16px] font-semibold">No organisation yet</h1>
        <p className="mt-2 text-[13px] leading-relaxed text-muted">
          Every row in this system carries the organisation that owns it, so
          there is nothing to show until one exists. Create it with{" "}
          <code className="bg-sunk px-1 py-0.5 text-[12px]">npm run db:seed</code>
          , or set <code className="bg-sunk px-1 py-0.5 text-[12px]">TAPTAP3D_ORG_SLUG</code>{" "}
          if there is more than one.
        </p>
      </div>
    );
  }

  // The workflow is needed BEFORE the query can be read: a tab is one of its
  // stage ids, and a house that has swapped workflows leaves stale ones in
  // people's bookmarks. `readQuery` falls those back to the default rather
  // than showing an empty table under a heading that names nothing.
  const [raw, events, workflow] = await Promise.all([
    searchParams,
    listEvents(org.id),
    workflowOf(org.id),
  ]);
  const view = readLedger(events, workflow, readQuery(raw, workflow));

  return (
    <div className="px-8 py-8">
      <PageHeader
        title="Events"
        meta={
          view.total === 0
            ? "none yet"
            : `${view.open} open · ${view.total} in all`
        }
      />
      <Ledger view={view} />
    </div>
  );
}
