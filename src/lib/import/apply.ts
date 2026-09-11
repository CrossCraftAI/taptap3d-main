// Turn a cleared mapping into lots.
//
// Pure and headless: a table in, records out, no database. That separation is
// what lets the screen show a person exactly what it is about to write BEFORE it
// writes it — the confirmation step is the same function the commit uses, not a
// second implementation that can disagree with it.

import type { CoreFieldKey } from "./fields";
import type { ParsedTable } from "./parse";

export type ColumnTarget =
  | { kind: "core"; field: CoreFieldKey }
  /** Kept under the customer's own header. The field set is theirs. */
  | { kind: "custom"; name: string }
  | { kind: "skip" };

/** One target per column, positionally. */
export type Mapping = ColumnTarget[];

export interface PreparedLot {
  /** The house's own reference, if a column was mapped to it. */
  ref: string | null;
  /** Everything mapped, core and custom alike, keyed by field name. */
  fields: Record<string, string>;
  /** Row number in the source file, 1-based, for pointing at a problem. */
  sourceRow: number;
}

export interface PreparedImport {
  lots: PreparedLot[];
  /**
   * Things a person should see before committing — never fatal, never silent.
   * An import that refuses is worse than one that warns: the specialist knows
   * things about their own file that this code does not.
   */
  warnings: string[];
  /** Rows skipped because every mapped column was empty. */
  skippedRows: number;
}

/**
 * Apply a mapping to a parsed table.
 *
 * Nothing is coerced. "800,000–1,200,000 HKD" stays that string, and "P01" stays
 * "P01" — interpreting a price as a range, or a dimension as centimetres, is a
 * later and separately reviewable step. Parsing on the way in is how a
 * spreadsheet's P01 becomes the number 1.
 */
export function applyMapping(
  table: ParsedTable,
  mapping: Mapping,
): PreparedImport {
  const warnings: string[] = [];
  const lots: PreparedLot[] = [];
  let skippedRows = 0;

  const refColumn = mapping.findIndex(
    (t) => t.kind === "core" && t.field === "ref",
  );

  // Two columns mapped to the same target would silently overwrite each other.
  // The matching screen prevents it for core fields, but a custom name is typed
  // by a person and two columns can easily be called the same thing.
  const seen = new Map<string, number>();
  mapping.forEach((target, column) => {
    if (target.kind === "skip") return;
    const name = target.kind === "core" ? target.field : target.name.trim();
    if (!name) return;
    const first = seen.get(name);
    if (first !== undefined) {
      warnings.push(
        `Columns “${table.headers[first]}” and “${table.headers[column]}” are both mapped to “${name}” — the later one wins.`,
      );
    }
    seen.set(name, column);
  });

  table.rows.forEach((row, index) => {
    const fields: Record<string, string> = {};
    for (let column = 0; column < mapping.length; column++) {
      const target = mapping[column];
      if (!target || target.kind === "skip") continue;
      const name = target.kind === "core" ? target.field : target.name.trim();
      if (!name) continue;
      const value = (row[column] ?? "").trim();
      // An empty cell is recorded as absent rather than as an empty string, so
      // "the client did not say" and "the client said nothing" do not become the
      // same thing downstream.
      if (value !== "") fields[name] = value;
    }

    if (Object.keys(fields).length === 0) {
      skippedRows += 1;
      return;
    }

    lots.push({
      ref: refColumn >= 0 ? ((row[refColumn] ?? "").trim() || null) : null,
      fields,
      // +1 for the header, +1 for 1-based counting, plus whatever was above it.
      sourceRow: table.source.headerRow + index + 2,
    });
  });

  // Duplicate references are worth saying out loud: a house's own numbering is
  // usually unique, so two P04s is either two sales merged into one sheet or a
  // copy-paste error — and the person holding the file knows which.
  const refCounts = new Map<string, number[]>();
  for (const lot of lots) {
    if (!lot.ref) continue;
    const rows = refCounts.get(lot.ref) ?? [];
    rows.push(lot.sourceRow);
    refCounts.set(lot.ref, rows);
  }
  for (const [ref, rows] of refCounts) {
    if (rows.length > 1) {
      warnings.push(`Reference “${ref}” appears ${rows.length} times (rows ${rows.join(", ")}).`);
    }
  }

  if (refColumn < 0) {
    warnings.push(
      "No column is mapped to 編號 / Reference. Photographs are matched to lots by reference, so they will have to be attached by hand.",
    );
  }
  if (skippedRows > 0) {
    warnings.push(`${skippedRows} row(s) were empty in every mapped column and will not be imported.`);
  }

  return { lots, warnings, skippedRows };
}
