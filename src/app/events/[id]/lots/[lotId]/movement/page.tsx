import Link from "next/link";
import { notFound } from "next/navigation";

import { MovementLogger } from "@/components/movement-logger";
import { PageHeader } from "@/components/page-header";
import { getEvent } from "@/lib/data/events";
import { getLot } from "@/lib/data/lots";
import {
  formatDay,
  formatMoment,
  listMovements,
  placesInUse,
  provenanceLine,
  provenanceOf,
  whereAreThey,
  whereItIs,
} from "@/lib/data/movements";
import { currentOrgId } from "@/lib/data/org";
import { asText } from "@/lib/engine/derive";

import { setProvenanceAction } from "./actions";

export const dynamic = "force-dynamic";

/**
 * Movement: where one lot is, and how it got there.
 *
 * ── THREE THINGS, IN THIS ORDER, AND THE ORDER IS THE ARGUMENT ──────────────
 *
 * WHERE IT IS, derived from the last leg and never stored, with the one gesture
 * that changes it — which appends rather than edits.
 * THE CHAIN, newest first, because the question a registrar has is almost
 * always about the most recent handoff.
 * WHAT THE CATALOGUE WOULD PRINT, from the legs marked public — rendered by
 * the same function that would print it, so the box cannot drift from the page.
 *
 * Every number on this screen is counted at read time. Nothing here has a
 * column of its own (ARCHITECTURE.md principle 2), which is what makes a
 * correction a new fact rather than an erasure.
 */
export default async function MovementPage({
  params,
}: {
  params: Promise<{ id: string; lotId: string }>;
}): Promise<React.ReactElement> {
  const { id, lotId } = await params;
  const orgId = await currentOrgId();
  const [event, lot] = await Promise.all([getEvent(orgId, id), getLot(orgId, lotId)]);
  if (!event || !lot || lot.eventId !== event.id) notFound();

  const [chain, standing, places] = await Promise.all([
    listMovements(orgId, lot.id),
    // The sale's whole register, for one number: who else is standing where
    // this lot is standing. It is the query the crate gesture needs, and the
    // register page needs it anyway, so it is one shape rather than two.
    whereAreThey(orgId, event.id),
    placesInUse(orgId),
  ]);

  const here = whereItIs(chain);
  const together = here
    ? [...standing.entries()]
        .filter(([, where]) => where.place === here.place)
        .map(([lotOf]) => lotOf)
    : [];
  const provenance = provenanceOf(chain);
  const title = asText(lot.fields.title) || "Untitled lot";

  return (
    <div className="px-8 py-8">
      <PageHeader
        parent={{ href: `/events/${event.id}/lots/${lot.id}`, label: lot.ref ?? title }}
        title={lot.ref ? `${lot.ref} · ${title}` : title}
        meta={
          <>
            {chain.length === 0
              ? "no movements logged"
              : `${chain.length} ${chain.length === 1 ? "movement" : "movements"}`}
            {provenance.length > 0 && (
              <>
                {" "}
                · {provenance.length} printed as provenance
              </>
            )}
          </>
        }
        actions={
          <Link
            href={`/events/${event.id}/lots/${lot.id}/condition`}
            className="inline-flex min-h-[var(--tap)] items-center border border-ruleStrong bg-paper px-3 text-[13px] font-medium hover:bg-sunk"
          >
            Condition
          </Link>
        }
      />

      <MovementLogger
        eventId={event.id}
        lotId={lot.id}
        place={here?.place ?? null}
        custodian={here?.custodian ?? null}
        since={here ? formatMoment(here.since) : null}
        together={together}
        places={places.map((p) => p.place)}
      />

      <section className="mt-8">
        <h2 className="text-[15px] font-medium">The chain</h2>
        {chain.length === 0 ? (
          <p className="mt-2 max-w-xl text-[13px] leading-relaxed text-muted">
            Nothing yet. A lot imported before this system recorded movements
            has no chain, and none was invented for it — a first leg nobody
            witnessed would be a fact in a record that exists to be argued from.
          </p>
        ) : (
          <ol className="mt-3 m-0 list-none border border-rule bg-paper p-0">
            {chain.map((leg) => (
              <li
                key={leg.id}
                className="flex flex-wrap items-start gap-4 border-b border-rule px-4 py-3 last:border-b-0"
              >
                <div className="w-28 shrink-0 text-[12px] text-faint" data-numeric>
                  {formatMoment(leg.occurredAt)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px]">
                    {leg.fromPlace ?? (
                      <span className="text-faint">from outside the house</span>
                    )}{" "}
                    <span aria-hidden="true" className="text-ruleStrong">
                      →
                    </span>{" "}
                    <span className="font-medium">{leg.toPlace}</span>
                  </p>
                  <p className="mt-0.5 text-[12px] text-muted">
                    {[
                      leg.reason,
                      leg.custodian,
                      // DERIVED, not stored: the lots that share this leg's
                      // instant, origin and destination. One is the ordinary
                      // case and says nothing, so it is not said.
                      leg.movedWith > 1 ? `moved with ${leg.movedWith - 1} more` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "no occasion given"}
                  </p>
                  {leg.note && (
                    <p className="mt-0.5 text-[12px] leading-relaxed text-faint">{leg.note}</p>
                  )}
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  {leg.reports > 0 ? (
                    <Link
                      href={`/events/${event.id}/lots/${lot.id}/condition`}
                      className="inline-flex min-h-[var(--tap)] items-center border border-go px-2 text-[10px] font-semibold uppercase tracking-wide text-go hover:bg-goSoft"
                    >
                      {leg.reports === 1
                        ? "Condition report"
                        : `${leg.reports} condition reports`}
                    </Link>
                  ) : (
                    /* NOT A BUTTON THAT DOES NOTHING. A leg with no report
                       offers the one thing that fixes it: the condition
                       screen, where an examination can be filed against this
                       handoff. */
                    <Link
                      href={`/events/${event.id}/lots/${lot.id}/condition`}
                      className="inline-flex min-h-[var(--tap)] items-center border border-ruleStrong px-2 text-[10px] font-semibold uppercase tracking-wide text-muted hover:bg-sunk"
                    >
                      No report
                    </Link>
                  )}
                  {/* The one editable thing on a leg, and it is a decision
                      about the CATALOGUE rather than about custody. A plain
                      form: the page re-renders and the provenance box above
                      gains or loses a line, which is the whole acknowledgement
                      the gesture needs. */}
                  <form action={setProvenanceAction.bind(null, event.id, lot.id, leg.id)}>
                    <input type="hidden" name="isPublic" value={leg.isPublic ? "" : "on"} />
                    <button
                      type="submit"
                      disabled={leg.fromPlace === null}
                      title={
                        leg.fromPlace === null
                          ? "An arrival from outside has no holder to name, so there is nothing to print."
                          : undefined
                      }
                      className={`inline-flex min-h-[var(--tap)] items-center border px-2 text-[10px] font-semibold uppercase tracking-wide disabled:opacity-40 ${
                        leg.isPublic
                          ? "border-seal bg-sealSoft text-seal"
                          : "border-ruleStrong text-muted hover:bg-sunk"
                      }`}
                    >
                      {leg.isPublic ? "Public as provenance" : "Internal"}
                    </button>
                  </form>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="mt-8">
        <h2 className="text-[15px] font-medium">What the catalogue prints from this chain</h2>
        <p className="mt-1 max-w-xl text-[12px] leading-relaxed text-muted">
          Only the legs marked public, and the lines below are produced by the
          same function that prints them — not a second description of it
          (src/lib/data/movements.ts, <code>provenanceOf</code>). Nothing here
          is typed twice.
        </p>
        <div className="mt-3 border border-rule bg-paper px-4 py-3">
          {provenance.length === 0 ? (
            <p className="text-[13px] text-faint">
              Nothing. Mark a leg public and its origin prints as a line of
              provenance.
            </p>
          ) : (
            <ol className="m-0 list-none p-0">
              {provenance.map((entry) => (
                <li
                  key={`${entry.place}-${entry.until.getTime()}`}
                  className="py-0.5 font-serif text-[13px] leading-relaxed"
                >
                  {provenanceLine(entry)}
                  {entry.reason && (
                    <span className="ml-2 font-sans text-[12px] text-faint">
                      {entry.reason} · {formatDay(entry.until)}
                    </span>
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>
      </section>
    </div>
  );
}
