// Turn whatever the client brought into a table, or say plainly that it could
// not.
//
// THIS IS THE RISKIEST CODE IN THE PRODUCT. It runs live, in front of a
// customer, on a file nobody here has ever opened — and by the time it runs, the
// pitch is already underway. So it is built to degrade rather than to fail:
// every outcome is a value describing what happened, never a thrown error, and
// the outcome that means "I could not read this" carries a reason a person can
// act on.
//
// What it does NOT do is guess at prose. A Word document or an email is handed
// to the paste-text path instead, where a human can see what is being read. That
// is a deliberate refusal: silently extracting rows from prose in front of a
// client is how you end up explaining, live, why lot 14 has half of lot 13's
// description in it.

import Papa from "papaparse";
import readXlsxFile from "read-excel-file/node";

export interface ParsedTable {
  kind: "table";
  /** Header names, in file order, with blanks filled as "Column N". */
  headers: string[];
  /** Data rows, aligned to `headers`; short rows are padded with "". */
  rows: string[][];
  source: {
    filename: string;
    format: "csv" | "tsv" | "xlsx";
    /** Which row the headers were found on — 0 unless there was a title block. */
    headerRow: number;
    /** Rows skipped above the header, kept so the UI can say what was ignored. */
    skippedRows: string[][];
    sheetName?: string;
    /** Other sheets in the workbook, named so the UI can offer them. */
    otherSheets?: string[];
  };
}

export interface UnreadableFile {
  kind: "unreadable";
  filename: string;
  /** Written for a specialist mid-pitch, not for a log. */
  reason: string;
  /** What to do instead. Always populated — a dead end is never the answer. */
  suggestion: string;
}

export type ParseResult = ParsedTable | UnreadableFile;

const TEXTUAL = new Set(["csv", "tsv", "txt", "tab"]);
const SPREADSHEET = new Set(["xlsx", "xlsm"]);

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot < 0 ? "" : filename.slice(dot + 1).toLowerCase();
}

/**
 * Where the real header row is.
 *
 * Client spreadsheets routinely open with a title, a date, a blank line and a
 * logo before the grid starts, so assuming row 0 is how an importer greets a
 * real file with headers named "", "", "Untitled". The header is taken to be the
 * first row that has at least two non-empty cells AND no duplicates among them —
 * a title block fails the first test, a merged banner fails the second.
 *
 * Bounded to the first 20 rows: beyond that it is not a title block, it is a
 * different kind of document, and guessing further would be guessing.
 */
export function findHeaderRow(rows: string[][]): number {
  const limit = Math.min(rows.length, 20);
  for (let i = 0; i < limit; i++) {
    const cells = (rows[i] ?? []).map((c) => c.trim()).filter(Boolean);
    if (cells.length < 2) continue;
    if (new Set(cells).size !== cells.length) continue;
    return i;
  }
  return 0;
}

/** Pad short rows and name blank headers, so downstream never index-checks. */
function squareUp(
  headerCells: string[],
  bodyRows: string[][],
): { headers: string[]; rows: string[][] } {
  const width = Math.max(
    headerCells.length,
    ...bodyRows.map((r) => r.length),
    1,
  );
  const headers = Array.from({ length: width }, (_, i) => {
    const raw = (headerCells[i] ?? "").trim();
    // A blank header is named rather than dropped: the COLUMN still holds data,
    // and a person needs something to point at on the matching screen.
    return raw || `Column ${i + 1}`;
  });
  const rows = bodyRows
    .map((r) => Array.from({ length: width }, (_, i) => (r[i] ?? "").trim()))
    // A row that is entirely empty is spreadsheet padding, not a lot.
    .filter((r) => r.some((c) => c !== ""));
  return { headers, rows };
}

/**
 * What `read-excel-file` actually hands back, which is not what its signature
 * suggests: an array of `{ sheet, data }` for a workbook, but a flat array of
 * rows in other versions and code paths. Both shapes are accepted rather than
 * assumed, because being wrong here fails on a customer's file rather than on
 * ours — the first version of this assumed rows and died with "row.map is not a
 * function".
 */
function selectSheet(read: unknown): {
  matrix: string[][];
  sheetName?: string;
  otherSheets: string[];
} {
  const stringify = (cell: unknown): string =>
    cell === null || cell === undefined ? "" : String(cell);
  const asMatrix = (rows: unknown): string[][] =>
    Array.isArray(rows)
      ? rows.map((row) => (Array.isArray(row) ? row.map(stringify) : []))
      : [];

  if (!Array.isArray(read) || read.length === 0) return { matrix: [], otherSheets: [] };

  const first = read[0];
  const isWorkbook =
    typeof first === "object" && first !== null && "data" in first;

  if (!isWorkbook) return { matrix: asMatrix(read), otherSheets: [] };

  const sheets = read as Array<{ sheet?: string; data?: unknown }>;
  // The first sheet that contains a TABLE — not merely the first that contains
  // anything. A cover page holds one cell of text, so "has data" picks it and
  // then reports the workbook as empty; the test for a table is the same one
  // findHeaderRow uses, plus at least one row beneath the header.
  const looksTabular = (matrix: string[][]): boolean => {
    const header = findHeaderRow(matrix);
    const cells = (matrix[header] ?? []).map((c) => c.trim()).filter(Boolean);
    if (cells.length < 2) return false;
    return matrix
      .slice(header + 1)
      .some((r) => r.some((c) => c.trim() !== ""));
  };
  const chosenIndex = Math.max(
    0,
    sheets.findIndex((s) => looksTabular(asMatrix(s.data))),
  );
  const chosen = sheets[chosenIndex];
  return {
    matrix: asMatrix(chosen?.data),
    ...(chosen?.sheet ? { sheetName: chosen.sheet } : {}),
    otherSheets: sheets
      .filter((_, i) => i !== chosenIndex)
      .map((s) => s.sheet ?? "")
      .filter(Boolean),
  };
}

function fromMatrix(
  matrix: string[][],
  filename: string,
  format: ParsedTable["source"]["format"],
  sheetName?: string,
): ParseResult {
  if (matrix.length === 0) {
    return {
      kind: "unreadable",
      filename,
      reason: "The file opened but contained no rows.",
      suggestion:
        "Check it is the right file, or paste the lot list as text instead.",
    };
  }
  const headerRow = findHeaderRow(matrix);
  const { headers, rows } = squareUp(
    matrix[headerRow] ?? [],
    matrix.slice(headerRow + 1),
  );
  if (rows.length === 0) {
    return {
      kind: "unreadable",
      filename,
      reason: `Found headers on row ${headerRow + 1} but no data beneath them.`,
      suggestion: "Check the sheet, or paste the lot list as text instead.",
    };
  }
  return {
    kind: "table",
    headers,
    rows,
    source: {
      filename,
      format,
      headerRow,
      skippedRows: matrix.slice(0, headerRow),
      ...(sheetName ? { sheetName } : {}),
    },
  };
}

function parseDelimited(
  text: string,
  filename: string,
  format: "csv" | "tsv",
): ParseResult {
  const parsed = Papa.parse<string[]>(text, {
    // Headers are found by findHeaderRow, not by Papa: Papa's `header: true`
    // assumes row 0, which is the assumption this module exists to avoid.
    header: false,
    // EMPTY LINES ARE KEPT, deliberately. Stripping them first shifts every
    // index, so `headerRow` would stop meaning "the row you can see in Excel"
    // — and the screen tells a person which rows it ignored above the grid.
    // Blank rows are dropped later, in squareUp, where doing so costs no index.
    skipEmptyLines: false,
    delimiter: format === "tsv" ? "\t" : "",
  });
  const matrix = (parsed.data ?? []).map((row) =>
    (row ?? []).map((cell) => String(cell ?? "")),
  );
  return fromMatrix(matrix, filename, format);
}

/**
 * Read a file the customer brought.
 *
 * Never throws. Every failure is an `unreadable` carrying a reason and a way
 * forward, because the caller is a screen in front of a client rather than a
 * log.
 */
export async function parseUpload(
  bytes: Uint8Array,
  filename: string,
): Promise<ParseResult> {
  const ext = extensionOf(filename);

  if (bytes.byteLength === 0) {
    return {
      kind: "unreadable",
      filename,
      reason: "The file is empty.",
      suggestion: "Re-export it, or paste the lot list as text instead.",
    };
  }

  try {
    if (SPREADSHEET.has(ext)) {
      // read-excel-file wants a Buffer in Node. Rows arrive as mixed cell types;
      // everything is stringified here rather than interpreted — a lot's "P01"
      // must not become the number 1, which is the exact failure the
      // predecessor's corpus documented.
      const read = await readXlsxFile(Buffer.from(bytes));
      const { matrix, sheetName, otherSheets } = selectSheet(read);
      const result = fromMatrix(matrix, filename, "xlsx", sheetName);
      // A workbook with several sheets is normal — a "lots" sheet beside a
      // "terms" sheet and a "photos" sheet. The first one with data is used and
      // the rest are NAMED, so the screen can offer them rather than leaving a
      // person wondering why half their lots are missing.
      if (result.kind === "table" && otherSheets.length > 0) {
        result.source.otherSheets = otherSheets;
      }
      return result;
    }

    if (TEXTUAL.has(ext) || ext === "") {
      const text = new TextDecoder("utf-8").decode(bytes);
      return parseDelimited(
        text,
        filename,
        ext === "tsv" || ext === "tab" ? "tsv" : "csv",
      );
    }

    return {
      kind: "unreadable",
      filename,
      reason: `".${ext}" files are not read directly yet.`,
      suggestion:
        "Open it, copy the lot list, and paste it as text — that path takes any format.",
    };
  } catch (error) {
    // The library's message, surfaced rather than swallowed: "Corrupted zip"
    // tells a specialist more than "could not read file" does, and this is not
    // a security boundary.
    return {
      kind: "unreadable",
      filename,
      reason:
        error instanceof Error
          ? `The file could not be opened — ${error.message}`
          : "The file could not be opened.",
      suggestion:
        "Check it opens in Excel, or paste the lot list as text instead.",
    };
  }
}

/**
 * The escape hatch: text a person pasted.
 *
 * Tab- and comma-separated both arrive this way — pasting a spreadsheet
 * selection yields tabs — so the delimiter is sniffed from the first line rather
 * than demanded. Everything else in the module is downstream of the same
 * squaring and header detection, so a pasted table behaves identically to an
 * uploaded one.
 */
export function parsePastedText(text: string): ParseResult {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const tabs = (firstLine.match(/\t/g) ?? []).length;
  const commas = (firstLine.match(/,/g) ?? []).length;
  return parseDelimited(
    text,
    "pasted text",
    tabs >= commas && tabs > 0 ? "tsv" : "csv",
  );
}
