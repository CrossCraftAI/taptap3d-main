import Link from "next/link";
import { notFound } from "next/navigation";

import { Dropzone } from "@/components/dropzone";
import { LotCatalogueForm, type OverrideRowSpec } from "@/components/lot-catalogue-form";
import { LotFieldsForm, type FieldRow } from "@/components/lot-fields-form";
import { LotPhotographs } from "@/components/lot-photographs";
import { LotSteps } from "@/components/lot-steps";
import { PageHeader } from "@/components/page-header";
import { listAssetsForLot } from "@/lib/data/assets";
import { getCatalogue } from "@/lib/data/catalogues";
import { getEvent } from "@/lib/data/events";
import { getLot, lotNeighbours } from "@/lib/data/lots";
import { currentOrgId } from "@/lib/data/org";
import { listOverridesForLot } from "@/lib/data/overrides";
import { asText } from "@/lib/engine/derive";
import { CORE_FIELDS } from "@/lib/import/fields";

export const dynamic = "force-dynamic";

const CORE_ORDER = CORE_FIELDS.map((f) => f.key);
const LABEL = new Map(CORE_FIELDS.map((f) => [f.key as string, f.label]));
const isCore = (key: string): boolean =>
  CORE_ORDER.includes(key as (typeof CORE_ORDER)[number]);

/** Long by shape: the value is long, whatever the column is called. */
const long = (value: string): boolean => value.length > 80 || value.includes("\n");

export default async function LotPage({
  params,
}: {
  params: Promise<{ id: string; lotId: string }>;
}): Promise<React.ReactElement> {
  const { id, lotId } = await params;
  const orgId = await currentOrgId();
  // The step rides along with the lot rather than after it: it is scoped by
  // (org, event, lot) exactly as the two beside it are, so it needs nothing
  // they return and adds no round trip. It comes back null for a lot that is
  // not this event's — the same case the line below already sends to 404.
  const [event, lot, step] = await Promise.all([
    getEvent(orgId, id),
    getLot(orgId, lotId),
    lotNeighbours(orgId, id, lotId),
  ]);
  if (!event || !lot || lot.eventId !== event.id) notFound();

  // READ, not ensured: a lot page is not a request for a catalogue. Until the
  // catalogue screen has been opened once there is nothing to override in.
  const [photographs, catalogue] = await Promise.all([
    listAssetsForLot(orgId, lot.id),
    getCatalogue(orgId, event.id),
  ]);
  const overrides = catalogue
    ? await listOverridesForLot(orgId, catalogue.id, lot.id)
    : [];

  const fields = lot.fields ?? {};
  const customKeys = Object.keys(fields).filter(
    (key) => !isCore(key) && !key.startsWith("_"),
  );
  const carried = Object.entries(fields).filter(([key]) => key.startsWith("_"));

  // ── The record ────────────────────────────────────────────────────────────
  // Every core field, present or not, so a missing maker can be typed in; then
  // the house's own columns. `ref` reads the column, because that is what the
  // ledger and the pins read — the copy in `fields` follows it on save.
  const recordRows: FieldRow[] = [
    ...CORE_ORDER.filter((key) => key !== "images").map((key): FieldRow => {
      const value = key === "ref" ? (lot.ref ?? asText(fields.ref)) : asText(fields[key]);
      const label = LABEL.get(key)!;
      return { key, label: label.zh, hint: label.en, value, long: long(value) };
    }),
    ...customKeys.map((key): FieldRow => {
      const value = asText(fields[key]);
      return { key, label: key, hint: "the house's column", value, long: long(value) };
    }),
  ];

  // ── This catalogue ────────────────────────────────────────────────────────
  const byField = new Map(overrides.map((o) => [o.field, o]));
  const overrideRow = (
    key: string,
    label: string,
    record: string,
    hint?: string,
    hideOnly = false,
  ): OverrideRowSpec => {
    const own = byField.get(key);
    return {
      key,
      label,
      hint,
      record,
      hidden: own?.hidden === true,
      text: own?.text ?? "",
      placed: own?.frame !== undefined,
      hideOnly,
    };
  };
  const catalogueRows: OverrideRowSpec[] = [
    ...CORE_ORDER.filter((key) => key !== "images").map((key) => {
      const label = LABEL.get(key)!;
      const record = key === "ref" ? (lot.ref ?? "") : asText(fields[key]);
      return overrideRow(key, label.zh, record, label.en);
    }),
    ...customKeys.map((key) => overrideRow(key, key, asText(fields[key]), "the house's column")),
    overrideRow(
      "images",
      "plate",
      photographs.length === 0
        ? ""
        : `${photographs.length} ${photographs.length === 1 ? "photograph" : "photographs"}`,
      "the photograph",
      true,
    ),
    // An override on a field the record no longer has still prints, so it is
    // still shown — otherwise it could be neither seen nor removed.
    ...overrides
      .filter((o) => o.field !== "images" && !isCore(o.field) && !customKeys.includes(o.field))
      .map((o) => overrideRow(o.field, o.field, "", "no longer in the record")),
  ];

  const title = asText(fields.title) || "Untitled lot";

  return (
    <div className="px-8 py-8">
      <PageHeader
        parent={{ href: `/events/${event.id}`, label: event.name }}
        title={lot.ref ? `${lot.ref} · ${title}` : title}
        meta={
          <>
            {photographs.length === 0
              ? "no photographs"
              : `${photographs.length} ${photographs.length === 1 ? "photograph" : "photographs"}`}
            {overrides.length > 0 && (
              <span className="text-seal">
                {" "}
                · {overrides.length} {overrides.length === 1 ? "field" : "fields"} overridden in the
                catalogue
              </span>
            )}
          </>
        }
        actions={
          <>
            {/* Where in the sale this is, and the two lots either side. First
                in the row because it is where the hand goes back to. */}
            {step && <LotSteps eventId={event.id} step={step} />}
            <Link
              href={`/events/${event.id}/catalogue`}
              className="border border-ruleStrong bg-paper px-3 py-1.5 text-[13px] font-medium hover:bg-sunk"
            >
              Open catalogue
            </Link>
          </>
        }
      />

      <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section>
          <h2 className="text-[15px] font-medium">Fields</h2>
          <p className="mt-1 text-[12px] leading-relaxed text-muted">
            The record. A change here prints in every catalogue of this sale — a typo
            is wrong everywhere.
          </p>
          <LotFieldsForm
            eventId={event.id}
            lotId={lot.id}
            rows={recordRows}
            version={lot.updatedAt.getTime()}
          />

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
          <h2 className="text-[15px] font-medium">Photographs</h2>
          {/* Dropping onto THIS page attaches to THIS lot — and the file still
              lands in the library, so nothing is trapped inside one lot. */}
          <Dropzone lotId={lot.id} label="Add to this lot">
            <LotPhotographs lotId={lot.id} assets={photographs} />
          </Dropzone>
        </section>
      </div>

      <section className="mt-10">
        <h2 className="text-[15px] font-medium">In the catalogue</h2>
        {/* ALWAYS THE FORM, never an errand. This was gated on a catalogue row
            existing, with a panel saying "This sale has no catalogue yet — open
            it once and it exists". That was a true instruction while opening
            the editor made the row; now that a GET makes nothing, it would have
            been a dead end — go to another screen, cause a side effect, come
            back. The save makes the row (./actions.ts), so the decision a
            person came here to make is the thing that creates what holds it. */}
        <LotCatalogueForm
          eventId={event.id}
          lotId={lot.id}
          catalogueId={catalogue?.id ?? null}
          catalogueName={catalogue?.name ?? `${event.name} catalogue`}
          rows={catalogueRows}
          version={catalogue?.updatedAt.getTime() ?? 0}
        />
      </section>
    </div>
  );
}
