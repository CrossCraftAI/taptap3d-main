import { notFound } from "next/navigation";

import { Dropzone } from "@/components/dropzone";
import { LotPhotographs } from "@/components/lot-photographs";
import { PageHeader } from "@/components/page-header";
import { listAssetsForLot } from "@/lib/data/assets";
import { getEvent } from "@/lib/data/events";
import { getLot } from "@/lib/data/lots";
import { currentOrgId } from "@/lib/data/org";
import { asText } from "@/lib/engine/derive";
import { CORE_FIELDS } from "@/lib/import/fields";

export const dynamic = "force-dynamic";

const CORE_ORDER = CORE_FIELDS.map((f) => f.key);
const LABEL = new Map(CORE_FIELDS.map((f) => [f.key as string, f.label]));

export default async function LotPage({
  params,
}: {
  params: Promise<{ id: string; lotId: string }>;
}): Promise<React.ReactElement> {
  const { id, lotId } = await params;
  const orgId = await currentOrgId();
  const [event, lot] = await Promise.all([
    getEvent(orgId, id),
    getLot(orgId, lotId),
  ]);
  if (!event || !lot || lot.eventId !== event.id) notFound();

  const photographs = await listAssetsForLot(orgId, lot.id);
  const entries = Object.entries(lot.fields ?? {});

  // Three groups, in the order a person cares about them: the fields the
  // catalogue prints, the customer's own columns, and the values carried across
  // from the predecessor that exist so nothing was thrown away.
  const core = CORE_ORDER.filter((key) => key !== "images")
    .map((key) => [key, lot.fields?.[key]] as const)
    .filter(([, value]) => asText(value) !== "");
  const custom = entries.filter(
    ([key]) =>
      !CORE_ORDER.includes(key as (typeof CORE_ORDER)[number]) &&
      !key.startsWith("_") &&
      asText(entries.find(([k]) => k === key)?.[1]) !== "",
  );
  const carried = entries.filter(([key]) => key.startsWith("_"));

  const title = asText(lot.fields?.title) || "Untitled lot";

  return (
    <div className="px-8 py-8">
      <PageHeader
        parent={{ href: `/events/${event.id}`, label: event.name }}
        title={lot.ref ? `${lot.ref} · ${title}` : title}
        meta={
          photographs.length === 0
            ? "no photographs"
            : `${photographs.length} ${photographs.length === 1 ? "photograph" : "photographs"}`
        }
      />

      <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <section>
          <h2 className="text-[14px] font-medium">Fields</h2>
          <dl className="mt-3 border border-rule bg-paper">
            {core.map(([key, value]) => (
              <div
                key={key}
                className="flex gap-4 border-b border-rule px-4 py-2 last:border-b-0"
              >
                <dt className="w-28 shrink-0 text-[12px] text-muted">
                  {LABEL.get(key)?.zh ?? key}
                </dt>
                <dd className="min-w-0 flex-1 text-[13px]">{asText(value)}</dd>
              </div>
            ))}
            {core.length === 0 && (
              <p className="px-4 py-6 text-center text-[13px] text-muted">
                This lot arrived with no values in the catalogue fields.
              </p>
            )}
          </dl>

          {custom.length > 0 && (
            <>
              <h2 className="mt-6 text-[14px] font-medium">
                The house&rsquo;s own columns
              </h2>
              <dl className="mt-3 border border-rule bg-paper">
                {custom.map(([key, value]) => (
                  <div
                    key={key}
                    className="flex gap-4 border-b border-rule px-4 py-2 last:border-b-0"
                  >
                    <dt className="w-28 shrink-0 truncate text-[12px] text-muted">
                      {key}
                    </dt>
                    <dd className="min-w-0 flex-1 text-[13px]">{asText(value)}</dd>
                  </div>
                ))}
              </dl>
            </>
          )}

          {carried.length > 0 && (
            <details className="mt-6">
              <summary className="cursor-pointer text-[13px] text-muted hover:text-ink">
                {carried.length} carried values
              </summary>
              <p className="mt-1 text-[12px] leading-relaxed text-faint">
                Kept from the predecessor because they are the house&rsquo;s data.
                They do not print — the dimensions and the estimate above are what
                the catalogue uses.
              </p>
              <dl className="mt-2 border border-rule bg-paper">
                {carried.map(([key, value]) => (
                  <div
                    key={key}
                    className="flex gap-4 border-b border-rule px-4 py-1.5 last:border-b-0"
                  >
                    <dt className="w-28 shrink-0 truncate text-[12px] text-faint">
                      {key.slice(1)}
                    </dt>
                    <dd className="min-w-0 flex-1 text-[12px] text-muted">
                      {asText(value)}
                    </dd>
                  </div>
                ))}
              </dl>
            </details>
          )}
        </section>

        <section>
          <h2 className="text-[14px] font-medium">Photographs</h2>
          {/* Dropping onto THIS page attaches to THIS lot — and the file still
              lands in the library, so nothing is trapped inside one lot. */}
          <Dropzone lotId={lot.id} label="Add to this lot">
            <LotPhotographs lotId={lot.id} assets={photographs} />
          </Dropzone>
        </section>
      </div>
    </div>
  );
}
