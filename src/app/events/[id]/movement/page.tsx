import type { Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/page-header";
import { getEvent } from "@/lib/data/events";
import { listLots } from "@/lib/data/lots";
import { formatMoment, whereAreThey } from "@/lib/data/movements";
import { currentOrgId } from "@/lib/data/org";
import { asText } from "@/lib/engine/derive";

export const dynamic = "force-dynamic";

/**
 * Movement, for a whole sale: where everything is.
 *
 * ── WHY THE RAIL NEEDS THIS AND NOT THE LOT'S OWN SCREEN ────────────────────
 *
 * The drawing puts Movement in the sale's rail and lands on ONE record, and
 * its own annotation calls that the defect it is: "a screen that cannot tell
 * you what it is about". A rail item is a PLACE and a place cannot name a lot,
 * so the sale-scoped screen is the register — every lot, where it is — and one
 * lot's chain is a door out of a row. That also makes the two altitudes the
 * drawing asks for real: "log 153 arrivals" is only actionable if it lands on
 * exactly those lots.
 *
 * ── EVERY NUMBER HERE IS DERIVED, IN ONE QUERY ──────────────────────────────
 *
 * `whereAreThey` is one `distinct on` over the chain, so a 128-lot sale is one
 * round trip and not 128. Nothing on this screen is stored: a place is the last
 * movement's destination, and the group standing in a place — a crate — is the
 * lots whose last movement points at it.
 */
export default async function MovementRegisterPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.ReactElement> {
  const { id } = await params;
  const orgId = await currentOrgId();
  const event = await getEvent(orgId, id);
  if (!event) notFound();

  const [lots, standing] = await Promise.all([
    // The narrow read: this screen wants a ref, a title and an id, and
    // `listLotsWithImages` would ship a row per photograph to learn them.
    listLots(orgId, event.id),
    whereAreThey(orgId, event.id),
  ]);

  const placed = lots.filter((lot) => standing.has(lot.id));
  // Places, biggest first — the crate view. Derived from the same map the
  // table reads, so the two cannot disagree about where anything is.
  const byPlace = new Map<string, number>();
  for (const lot of placed) {
    const place = standing.get(lot.id)!.place;
    byPlace.set(place, (byPlace.get(place) ?? 0) + 1);
  }
  const places = [...byPlace.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

  return (
    <div className="px-8 py-8">
      <PageHeader
        parent={{ href: `/events/${event.id}`, label: event.name }}
        title="Movement"
        meta={
          <>
            {placed.length} of {lots.length} lots have a chain
            {lots.length - placed.length > 0 && (
              <> · {lots.length - placed.length} nowhere recorded</>
            )}
          </>
        }
      />

      {lots.length === 0 ? (
        <div className="mt-6 border border-rule bg-paper px-8 py-16 text-center">
          <p className="text-[15px] font-medium">This sale has no lots.</p>
          <p className="mx-auto mt-2 max-w-md text-[13px] leading-relaxed text-muted">
            There is nothing to move yet. Import the file the client sent and
            every lot arrives here with an empty chain.
          </p>
          <Link
            href={`/events/${event.id}/import`}
            className="mt-5 inline-flex min-h-[var(--tap)] items-center bg-seal px-4 text-[13px] font-medium text-paper hover:bg-sealPress"
          >
            Import lots
          </Link>
        </div>
      ) : (
        <>
          {places.length > 0 && (
            <section className="mt-6">
              <h2 className="text-[10px] font-semibold uppercase tracking-wide text-faint">
                Where this sale is standing
              </h2>
              {/* A CRATE IS A PLACE, so it appears here beside a warehouse and
                  a studio with no special casing anywhere. The count is the
                  lots of THIS sale standing in it; a crate holding two sales'
                  lots reads smaller here than it is, which is the honest
                  number for a screen that is about one sale. */}
              <ul className="mt-2 flex flex-wrap gap-2">
                {places.map(([place, count]) => (
                  <li
                    key={place}
                    className="border border-rule bg-paper px-3 py-1 text-[12px]"
                  >
                    {place}{" "}
                    <span data-numeric className="text-faint">
                      {count}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <div className="mt-6 border border-rule bg-paper">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-rule text-left text-[10px] tracking-wide text-muted">
                  <th className="w-28 px-4 py-2 font-medium">Ref</th>
                  <th className="px-4 py-2 font-medium">Title</th>
                  <th className="w-56 px-4 py-2 font-medium">Where it is</th>
                  <th className="w-40 px-4 py-2 font-medium">Who has it</th>
                  <th className="w-44 px-4 py-2 font-medium">Since</th>
                </tr>
              </thead>
              <tbody>
                {lots.map((lot) => {
                  const where = standing.get(lot.id);
                  // `as Route` for the reason src/components/switcher.tsx records:
                  // `typedRoutes` cannot check a path built from an id at
                  // runtime — it is a plain string to the compiler whatever
                  // is annotated. The PATTERN behind it is checked against
                  // src/app on disk by test/nav.test.ts, which reads the
                  // filesystem and is the stronger guard.
                  const href = `/events/${event.id}/lots/${lot.id}/movement` as Route;
                  return (
                    <tr
                      key={lot.id}
                      className="border-b border-rule last:border-b-0 hover:bg-sunk"
                    >
                      <td className="px-4 py-2 font-medium" data-numeric>
                        <Link
                          href={href}
                          className="inline-flex min-h-[var(--tap)] items-center hover:text-seal hover:underline"
                        >
                          {lot.ref ?? <span className="text-faint">—</span>}
                        </Link>
                      </td>
                      <td className="max-w-0 truncate px-4 py-2">
                        <Link
                          href={href}
                          className="inline-flex min-h-[var(--tap)] max-w-full items-center truncate hover:text-seal hover:underline"
                        >
                          {asText(lot.fields.title) || (
                            <span className="text-faint">untitled</span>
                          )}
                        </Link>
                      </td>
                      <td className="max-w-0 truncate px-4 py-2">
                        {where ? (
                          <>
                            {where.place}
                            {where.alongside > 0 && (
                              <span className="ml-1 text-[12px] text-faint" data-numeric>
                                +{where.alongside}
                              </span>
                            )}
                          </>
                        ) : (
                          /* NOT "unknown" AND NOT A BLANK. Nobody has said
                             where this is, which is a different fact from
                             "lost" and from "at the house", and it is the state
                             every lot imported before this table existed is in. */
                          <span className="text-faint">nowhere recorded</span>
                        )}
                      </td>
                      <td className="max-w-0 truncate px-4 py-2 text-muted">
                        {where?.custodian ?? "—"}
                      </td>
                      <td className="px-4 py-2 text-muted" data-numeric>
                        {where ? formatMoment(where.since) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
