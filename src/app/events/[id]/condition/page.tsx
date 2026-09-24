import type { Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/page-header";
import { conditionOf } from "@/lib/data/examinations";
import { getEvent } from "@/lib/data/events";
import { listLots } from "@/lib/data/lots";
import { formatDay } from "@/lib/data/movements";
import { currentOrgId } from "@/lib/data/org";
import { asText } from "@/lib/engine/derive";

export const dynamic = "force-dynamic";

/**
 * Condition, for a whole sale: what has been examined and what has not.
 *
 * It is a CONDITION REPORT. Not "conditional".
 *
 * ── THE SECOND ALTITUDE, WHICH IS THE ONE THE DRAWING MISSED ────────────────
 *
 * "Check condition on 87 lots" is only an action if it lands somewhere that
 * holds exactly those 87 with the same verb on every row. The drawing's rail
 * item opened one record instead, and annotated itself about it. So the
 * sale-scoped screen is this register and one lot's report is a door out of a
 * row — the same shape the movement register takes, deliberately, because a
 * registrar moves between the two all day.
 *
 * WHAT IS NOT HERE: a filter. The mockup draws "Needs a condition check" as a
 * chip on the lots table, and a filter over 128 rows that are already sorted
 * by what is missing would be a control whose only outcome is to hide rows
 * somebody can already see. It earns its place when a sale is long enough to
 * scroll, which is the same moment this table needs paging, and neither is
 * shipped as a guess.
 */
export default async function ConditionRegisterPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.ReactElement> {
  const { id } = await params;
  const orgId = await currentOrgId();
  const event = await getEvent(orgId, id);
  if (!event) notFound();

  const [lots, condition] = await Promise.all([
    listLots(orgId, event.id),
    conditionOf(orgId, event.id),
  ]);
  const examined = lots.filter((lot) => condition.has(lot.id));

  return (
    <div className="px-8 py-8">
      <PageHeader
        parent={{ href: `/events/${event.id}`, label: event.name }}
        title="Condition"
        meta={
          <>
            {examined.length} of {lots.length} lots examined
            {lots.length - examined.length > 0 && (
              <> · {lots.length - examined.length} without a report</>
            )}
          </>
        }
      />

      {lots.length === 0 ? (
        <div className="mt-6 border border-rule bg-paper px-8 py-16 text-center">
          <p className="text-[15px] font-medium">This sale has no lots.</p>
          <p className="mx-auto mt-2 max-w-md text-[13px] leading-relaxed text-muted">
            There is nothing to examine yet. Import the file the client sent and
            every lot arrives here unexamined.
          </p>
          <Link
            href={`/events/${event.id}/import`}
            className="mt-5 inline-flex min-h-[var(--tap)] items-center bg-seal px-4 text-[13px] font-medium text-paper hover:bg-sealPress"
          >
            Import lots
          </Link>
        </div>
      ) : (
        <div className="mt-6 border border-rule bg-paper">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-rule text-left text-[10px] tracking-wide text-muted">
                <th className="w-28 px-4 py-2 font-medium">Ref</th>
                <th className="px-4 py-2 font-medium">Title</th>
                <th className="w-32 px-4 py-2 text-right font-medium">Examinations</th>
                <th className="w-24 px-4 py-2 text-right font-medium">Marks</th>
                <th className="w-40 px-4 py-2 font-medium">Last examined</th>
                <th className="w-32 px-4 py-2 font-medium">&nbsp;</th>
              </tr>
            </thead>
            <tbody>
              {lots.map((lot) => {
                const state = condition.get(lot.id);
                // `as Route` for the reason src/components/switcher.tsx records:
                  // `typedRoutes` cannot check a path built from an id at
                  // runtime — it is a plain string to the compiler whatever
                  // is annotated. The PATTERN behind it is checked against
                  // src/app on disk by test/nav.test.ts, which reads the
                  // filesystem and is the stronger guard.
                  const href = `/events/${event.id}/lots/${lot.id}/condition` as Route;
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
                    <td className="px-4 py-2 text-right" data-numeric>
                      {state ? state.examinations : <span className="text-faint">—</span>}
                    </td>
                    <td className="px-4 py-2 text-right" data-numeric>
                      {state ? state.marks : <span className="text-faint">—</span>}
                    </td>
                    <td className="px-4 py-2 text-muted" data-numeric>
                      {state ? formatDay(state.latestAt) : "—"}
                    </td>
                    <td className="px-4 py-2">
                      {/* THE SAME VERB ON EVERY ROW, which is what makes the
                          register actionable. It says which of the two things
                          it is, because "examine" on a lot that already has
                          three reports would read as a warning. */}
                      <Link
                        href={href}
                        className={`inline-flex min-h-[var(--tap)] items-center border px-2 text-[12px] font-medium ${
                          state
                            ? "border-ruleStrong bg-paper text-muted hover:bg-sunk"
                            : "border-seal bg-sealSoft text-seal hover:bg-paper"
                        }`}
                      >
                        {state ? "Open" : "Examine"}
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
