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
import { currentOrgId, fieldPolicyOf } from "@/lib/data/org";
import { listOverridesForLot } from "@/lib/data/overrides";
import { asText, normaliseParams } from "@/lib/engine/derive";
import {
  levelOf,
  readAudiences,
  reaches,
  type Audience,
  type AudienceReading,
} from "@/lib/engine/visibility";
import { CORE_FIELDS } from "@/lib/import/fields";

import { LEVEL_WORDS } from "./reach";

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
  const [photographs, catalogue, policy] = await Promise.all([
    listAssetsForLot(orgId, lot.id),
    getCatalogue(orgId, event.id),
    // The house's answer for each of its fields. Empty for every house that
    // has not set one, which is every house today, and then every badge and
    // every count below is absent rather than zero.
    fieldPolicyOf(orgId),
  ]);
  const overrides = catalogue
    ? await listOverridesForLot(orgId, catalogue.id, lot.id)
    : [];
  // Who the sale's catalogue is made for. Through `normaliseParams` and not
  // read out of the jsonb directly, so this screen and the engine resolve a
  // missing or nonsense value the same way — `public` — rather than this page
  // reporting an audience no output would actually use.
  const audience = normaliseParams(catalogue?.params).audience;

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
      return {
        key,
        label: label.zh,
        hint: label.en,
        value,
        long: long(value),
        level: levelOf(policy, key),
      };
    }),
    ...customKeys.map((key): FieldRow => {
      const value = asText(fields[key]);
      return {
        key,
        label: key,
        hint: "the house's column",
        value,
        long: long(value),
        level: levelOf(policy, key),
      };
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
    const level = levelOf(policy, key);
    return {
      key,
      label,
      hint,
      record,
      hidden: own?.hidden === true,
      text: own?.text ?? "",
      placed: own?.frame !== undefined,
      hideOnly,
      // `reaches` and not a comparison written out here: the ladder is declared
      // once, in the module the engine drops fields with, and a second reading
      // of it on this screen is how a page comes to disagree with the page it
      // is describing.
      withheld: reaches(level, audience) ? null : level,
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

  // ── Where this prints ─────────────────────────────────────────────────────
  //
  // The keys this lot actually HOLDS a value under, in the order the record
  // shows them, plus the plate by name when there is one. Not every key the
  // house has an answer for: this box is about this lot, and a level set for a
  // column this lot leaves empty holds nothing back from anything.
  const held = [
    ...recordRows.filter((row) => row.value !== "").map((row) => row.key),
    ...(photographs.length > 0 ? ["images"] : []),
  ];
  const readings = readAudiences(policy, held);
  // A MAP AND NOT A `nameOf` FUNCTION. The box is a server component and could
  // have taken a callback, but a prop that is data survives the day somebody
  // adds a "use client" to it, and this screen already has two client forms
  // reading from the same page.
  const labels = Object.fromEntries(held.map((key) => [key, LABEL.get(key)?.zh ?? key]));
  // THE SAME ARRAY AND THE SAME PREDICATE THE CATALOGUE FORM COUNTS — and it
  // is the same set the box above reads, because a field the record leaves
  // empty holds nothing back from anybody. Two counts of one noun on one
  // screen is how a person learns to believe neither.
  const heldBack = catalogueRows.filter(
    (row) => row.withheld !== null && row.record !== "",
  ).length;

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
            {/* Apart from the overrides, because it is not one: nobody working
                on this sale decided it, and it is not undone here. */}
            {heldBack > 0 && (
              <span className="text-seal"> · {heldBack} held back</span>
            )}
          </>
        }
        actions={
          <>
            {/* Where in the sale this is, and the two lots either side. First
                in the row because it is where the hand goes back to. */}
            {step && <LotSteps eventId={event.id} step={step} />}
            {/* THE TWO THINGS THAT HAPPEN TO AN OBJECT RATHER THAN TO ITS
                RECORD. They are reachable from the sale's own registers as
                well; they are here because the lot is where a registrar is
                standing when they need them, and a door that only exists two
                screens away is a door nobody uses. */}
            <Link
              href={`/events/${event.id}/lots/${lot.id}/condition`}
              className="inline-flex min-h-[var(--tap)] items-center border border-ruleStrong bg-paper px-3 text-[13px] font-medium hover:bg-sunk"
            >
              Condition
            </Link>
            <Link
              href={`/events/${event.id}/lots/${lot.id}/movement`}
              className="inline-flex min-h-[var(--tap)] items-center border border-ruleStrong bg-paper px-3 text-[13px] font-medium hover:bg-sunk"
            >
              Movement
            </Link>
            <Link
              href={`/events/${event.id}/catalogue`}
              className="inline-flex min-h-[var(--tap)] items-center border border-ruleStrong bg-paper px-3 text-[13px] font-medium hover:bg-sunk"
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

          <WhereThisPrints
            readings={readings}
            labels={labels}
            audience={audience}
            hasCatalogue={catalogue !== null}
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
          audience={audience}
          rows={catalogueRows}
          version={catalogue?.updatedAt.getTime() ?? 0}
        />
      </section>
    </div>
  );
}

/**
 * Where this lot's values go — one line per audience an output can be made for.
 *
 * ── WHY THE ROWS ARE AUDIENCES AND NOT THE THREE BUILT-IN TEMPLATES ─────────
 *
 * The drawing's box lists outputs. The honest version of that here lists the
 * three READERSHIPS, because an output's template says how a page looks and
 * its audience says who may read it, and only the second decides whether a
 * value appears at all. Listing "Catalogue · Price list · Tearsheet" would
 * also have to count what each carries AT ITS DENSITY — a price list of
 * twenty-eight rows drops fields to fit — and that number answers a different
 * question: a field short of the caption budget is not held back from anybody,
 * it did not fit on that page. Two kinds of absence under one heading is
 * exactly the confusion this box exists to end.
 *
 * ── AND WHY IT COUNTS NOTHING OF ITS OWN ────────────────────────────────────
 *
 * The readings come from `readAudiences`, which is built from the same
 * `levelOf` and `reaches` the engine drops fields with. This component prints
 * them. A count computed here would be a second opinion about the same
 * question, and the lot header already learned that lesson once — it counted
 * every override while the table below counted the two kinds it could draw,
 * and one screen carried two definitions of one noun.
 */
function WhereThisPrints({
  readings,
  labels,
  audience,
  hasCatalogue,
}: {
  readings: AudienceReading[];
  /** What each key is called, as the record above calls it. */
  labels: Record<string, string>;
  /** Who this sale's catalogue is made for, so one row can be marked as live. */
  audience: Audience;
  hasCatalogue: boolean;
}): React.ReactElement {
  const total = readings[0] ? readings[0].carried.length + readings[0].withheld.length : 0;
  const anyHeldBack = readings.some((r) => r.withheld.length > 0);

  return (
    <section className="mt-6 border border-rule bg-paper">
      <div className="border-b border-rule px-4 py-2">
        <h3 className="text-[13px] font-medium">Where this prints</h3>
        <p className="mt-0.5 text-[12px] leading-relaxed text-muted">
          An output carries the values its readership may have, and the engine drops the
          rest before a page is laid out. This is a reading of that, not a second rule.
        </p>
      </div>
      <table className="w-full border-collapse text-[13px]">
        <tbody>
          {readings.map((reading) => {
            const words = LEVEL_WORDS[reading.audience];
            const live = hasCatalogue && reading.audience === audience;
            return (
              <tr key={reading.audience} className="border-b border-rule last:border-b-0">
                <td className="w-28 px-4 py-1.5 align-top">
                  <span className="text-[12px] text-ink" title={words.means}>
                    {words.name}
                  </span>
                  {/* WHICH OF THE THREE IS ACTUALLY IN USE. Without it the box
                      is a table of hypotheticals, and the one row that
                      describes the document this sale is going to print reads
                      exactly like the two that do not. */}
                  {live && (
                    <span className="block text-[10px] text-faint">this sale&rsquo;s catalogue</span>
                  )}
                </td>
                <td className="w-28 px-4 py-1.5 align-top text-[12px] text-muted" data-numeric>
                  {reading.carried.length} of {total}
                </td>
                <td className="px-4 py-1.5 align-top">
                  {reading.withheld.length === 0 ? (
                    <span className="text-[12px] text-faint">nothing held back</span>
                  ) : (
                    <span className="text-[12px] text-seal">
                      holds back{" "}
                      {reading.withheld.map((w) => labels[w.key] ?? w.key).join(" · ")}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="border-t border-rule bg-field px-4 py-2 text-[12px] leading-relaxed text-faint">
        {/* THE DENOMINATOR, SPELLED OUT. "6 of 8" is only a number a reader can
            re-measure if they know what the eight were. */}
        Counted over the {total} {total === 1 ? "value" : "values"} this lot holds — every
        field above that is not empty, and its photographs as one.
        {anyHeldBack
          ? " A field is held back by the house's own answer for it, not by this sale;" +
            " changing it changes every output of every sale."
          : " The house has marked no field, so every output carries all of them."}
      </p>
    </section>
  );
}
