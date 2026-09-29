// The record's fourth tab: where this lot came from, in both senses.
//
// ── TWO DIFFERENT WORDS SPELLED THE SAME, AND THE TAB SAYS SO ──────────────
//
// "Provenance" in the trade is the chain of ownership a catalogue prints —
// "Lin family collection, Taipei, until 2019". "Provenance" in this codebase
// is also the record of where a row in the database came from: which file,
// which row of it, under which mapping a person cleared. A registrar chasing a
// wrong title needs the second; a specialist writing a catalogue entry needs
// the first. Putting them on one tab without naming the difference would be
// the most expensive kind of confusion this screen could cause, so each half
// carries a heading that says which question it answers.

import type { Route } from "next";
import Link from "next/link";

import type { LotImport } from "@/lib/data/lots";
import {
  formatDay,
  provenanceLine,
  type ProvenanceEntry,
} from "@/lib/data/movements";

/** One target of the cleared mapping, as `import_runs.mapping` stored it. */
interface MappingEntry {
  kind?: unknown;
  field?: unknown;
  name?: unknown;
}

/**
 * The mapping as a person reads it: the columns that became something, in the
 * order they stood in the file.
 *
 * The stored value is `unknown[]` on purpose — it is a record of what a schema
 * said on the day it was written, and a later schema must not make an older
 * run unreadable. So this reads defensively and shows what it can.
 */
function mappingLines(mapping: readonly unknown[]): { column: number; became: string }[] {
  return mapping
    .map((raw, index) => {
      const entry = (raw ?? {}) as MappingEntry;
      const became =
        entry.kind === "core" && typeof entry.field === "string"
          ? entry.field
          : entry.kind === "custom" && typeof entry.name === "string"
            ? `${entry.name} — the house's own`
            : null;
      return became === null ? null : { column: index + 1, became };
    })
    .filter((line): line is { column: number; became: string } => line !== null);
}

export function Provenance({
  imported,
  chain,
  onTheRecord,
  movementHref,
}: {
  /** Null only for a lot that has gone; the page 404s before that. */
  imported: LotImport | null;
  /** What the catalogue would print, oldest first. */
  chain: ProvenanceEntry[];
  /**
   * The house's own columns that mean an ownership chain — usually 來源 — as
   * heading and value. They live on Details and are only named here.
   */
  onTheRecord: { key: string; value: string }[];
  /**
   * `Route`, for the reason src/components/switcher.tsx records: `typedRoutes`
   * cannot know a path built at runtime, so the caller says it is one.
   */
  movementHref: Route;
}): React.ReactElement {
  const run = imported?.run ?? null;
  const mapping = run ? mappingLines(run.mapping) : [];

  return (
    <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <section>
        <h2 className="text-[15px] font-medium">Where the record came from</h2>
        <p className="mt-1 max-w-xl text-[12px] leading-relaxed text-muted">
          The import that made this row — the file, the row of it, and the
          mapping a person cleared before anything was written. This is the
          answer to &ldquo;why does this lot say that&rdquo;, three weeks
          later, about a file nobody still has.
        </p>

        {run === null ? (
          <p className="mt-3 border border-rule bg-field px-4 py-3 text-[13px] leading-relaxed text-muted">
            {/* NOT RECORDED is not the same as NOT IMPORTED, and the
                difference is the whole value of this box. */}
            Not recorded. This lot was written before the record kept which
            import produced which lot, or it was not made by an import at all.
            Nothing is missing from the lot itself — only the note of where it
            came from.
          </p>
        ) : (
          <>
            <dl className="mt-3 border border-rule bg-paper">
              <Row label="File">
                <span className="break-all">{run.filename}</span>
                <span className="ml-2 text-faint">{run.format}</span>
              </Row>
              <Row label="Row">
                {imported?.sourceRow === null ? (
                  <span className="text-faint">not recorded</span>
                ) : (
                  <span data-numeric>
                    {imported?.sourceRow} of {run.rowCount}
                  </span>
                )}
              </Row>
              <Row label="Imported">{formatDay(run.importedAt)}</Row>
              <Row label="That import">
                <span data-numeric>{run.lotCount}</span>{" "}
                {run.lotCount === 1 ? "lot" : "lots"} from{" "}
                <span data-numeric>{run.rowCount}</span>{" "}
                {run.rowCount === 1 ? "row" : "rows"}
              </Row>
            </dl>

            {run.warnings.length > 0 && (
              <div className="mt-3 border-l-2 border-seal bg-sealSoft px-4 py-2">
                <p className="text-[12px] font-medium text-ink">
                  {/* STORED BECAUSE "it warned me and I went ahead" and "it
                      never told me" are different facts — schema.ts's words,
                      and this is the screen that finally reads them. */}
                  {run.warnings.length}{" "}
                  {run.warnings.length === 1 ? "warning was" : "warnings were"}{" "}
                  shown before this was committed
                </p>
                <ul className="mt-1 list-none p-0">
                  {run.warnings.map((warning) => (
                    <li key={warning} className="text-[12px] leading-relaxed text-muted">
                      {warning}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {mapping.length > 0 && (
              <details className="mt-3">
                <summary className="flex min-h-[var(--tap)] cursor-pointer items-center text-[13px] text-muted hover:text-ink">
                  The mapping, as it was cleared
                </summary>
                <dl className="mt-2 border border-rule bg-paper">
                  {mapping.map((line) => (
                    <div
                      key={line.column}
                      className="flex gap-4 border-b border-rule px-4 py-1.5 last:border-b-0"
                    >
                      <dt className="w-28 shrink-0 text-[12px] text-faint">
                        Column <span data-numeric>{line.column}</span>
                      </dt>
                      <dd className="min-w-0 flex-1 text-[12px] text-muted">
                        {line.became}
                      </dd>
                    </div>
                  ))}
                </dl>
              </details>
            )}
          </>
        )}
      </section>

      <section>
        <h2 className="text-[15px] font-medium">Who owned it</h2>
        <p className="mt-1 max-w-xl text-[12px] leading-relaxed text-muted">
          {/* The same function the movement screen renders and the same one
              the catalogue prints from. A third description of it here is how
              three screens come to disagree. */}
          The chain of ownership a catalogue prints — the public legs of this
          lot&rsquo;s movement, in the order they are printed. A different
          sense of the word from the box beside it.
        </p>
        {/* THE THIRD SENSE OF THE WORD, AND THE ONE A SPECIALIST WROTE.
            Above the chain, not below it, because a lot whose chain is empty
            and whose 來源 column is full would otherwise read as a lot with
            no provenance — which is the opposite of the truth and exactly the
            mistake this whole tab exists to prevent. */}
        {onTheRecord.length > 0 && (
          <div className="mt-3 border-l-2 border-seal bg-sealSoft px-4 py-2">
            <p className="text-[12px] font-medium text-ink">
              The record also carries the house&rsquo;s own{" "}
              {onTheRecord.map((c) => c.key).join(" and ")} — on Details, where
              it is edited, and it prints.
            </p>
            {onTheRecord.map((column) => (
              <p
                key={column.key}
                className="mt-1 font-serif text-[13px] leading-relaxed text-muted"
              >
                {column.value === "" ? (
                  <span className="font-sans text-[12px] text-faint">
                    Empty on this lot.
                  </span>
                ) : (
                  column.value
                )}
              </p>
            ))}
            <p className="mt-1 text-[12px] leading-relaxed text-faint">
              That is the specialist&rsquo;s own words and this system did not
              write it. The chain below is what this system knows, and the two
              are not a substitute for each other.
            </p>
          </div>
        )}
        <div className="mt-3 border border-rule bg-paper px-4 py-3">
          {chain.length === 0 ? (
            <p className="text-[13px] text-faint">
              Nothing yet. A leg of the movement chain marked public prints its
              origin as a line of provenance.
            </p>
          ) : (
            <ol className="m-0 list-none p-0">
              {chain.map((entry) => (
                <li
                  key={`${entry.place}-${entry.until.getTime()}`}
                  className="py-0.5 font-serif text-[13px] leading-relaxed"
                >
                  {provenanceLine(entry)}
                  {entry.reason && (
                    <span className="ml-2 font-sans text-[12px] text-faint">
                      {entry.reason}
                    </span>
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>
        <p className="mt-2 text-[12px] leading-relaxed text-faint">
          A leg is marked public on the movement screen, where the whole chain
          — private legs included — is kept.
        </p>
        {/* A CONTROL ON THE FLOOR, not a word inside the sentence above it.
            An inline link in a 12px paragraph cannot carry `--tap` without
            breaking the line it sits in, so the way out of this box is its
            own thing — which is also where a hand goes looking for it. */}
        <Link
          href={movementHref}
          className="mt-2 inline-flex min-h-[var(--tap)] items-center border border-ruleStrong bg-paper px-3 text-[13px] font-medium hover:bg-sunk"
        >
          Open the movement chain
        </Link>
      </section>
    </div>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="flex gap-4 border-b border-rule px-4 py-1.5 last:border-b-0">
      <dt className="w-28 shrink-0 text-[12px] text-faint">{label}</dt>
      <dd className="min-w-0 flex-1 text-[13px] text-ink">{children}</dd>
    </div>
  );
}
