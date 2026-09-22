"use client";

import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";

import { applyMapping, type ColumnTarget, type Mapping } from "@/lib/import/apply";
import { CORE_FIELDS, type CoreFieldKey } from "@/lib/import/fields";
import { inferMapping } from "@/lib/import/infer";
import type { ParsedTable, ParseResult, UnreadableFile } from "@/lib/import/parse";

const FIELD_LABEL = new Map(CORE_FIELDS.map((f) => [f.key, f.label]));
const FIELD_HINT = new Map(CORE_FIELDS.map((f) => [f.key, f.hint]));

/** The select's value space, flattened so one string round-trips a target. */
function targetToValue(target: ColumnTarget): string {
  if (target.kind === "core") return `core:${target.field}`;
  if (target.kind === "custom") return "custom";
  return "skip";
}

function valueToTarget(value: string, header: string): ColumnTarget {
  if (value === "skip") return { kind: "skip" };
  if (value === "custom") return { kind: "custom", name: header };
  return { kind: "core", field: value.slice("core:".length) as CoreFieldKey };
}

function confidenceLabel(confidence: number): string {
  if (confidence >= 0.8) return "certain";
  if (confidence >= 0.5) return "likely";
  return "a guess";
}

export function ImportFlow({
  eventId,
}: {
  eventId: string;
}): React.ReactElement {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);

  const [table, setTable] = useState<ParsedTable | null>(null);
  const [unreadable, setUnreadable] = useState<UnreadableFile | null>(null);
  const [mapping, setMapping] = useState<Mapping>([]);
  const [pasted, setPasted] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [showSkipped, setShowSkipped] = useState(false);

  const suggestions = useMemo(
    () => (table ? inferMapping(table.headers, table.rows) : []),
    [table],
  );

  // The SAME pure function the server runs on commit. The screen's promise —
  // "this is exactly what will be written" — is only true because there is one
  // implementation, not two that can drift.
  const prepared = useMemo(
    () => (table ? applyMapping(table, mapping) : null),
    [table, mapping],
  );

  function receive(result: ParseResult): void {
    if (result.kind === "unreadable") {
      setUnreadable(result);
      setTable(null);
      return;
    }
    setUnreadable(null);
    setTable(result);
    const inferred = inferMapping(result.headers, result.rows);
    setMapping(
      result.headers.map((header, column) => {
        const suggestion = inferred[column];
        // AN UNMATCHED COLUMN IS KEPT, NOT SKIPPED. The field set is the
        // customer's; defaulting to "skip" would discard their data with extra
        // steps and call it a suggestion.
        return suggestion?.suggested
          ? { kind: "core", field: suggestion.suggested }
          : { kind: "custom", name: header };
      }),
    );
  }

  async function parseFile(file: File): Promise<void> {
    setBusy(true);
    setFailure(null);
    try {
      const body = new FormData();
      body.append("file", file);
      const response = await fetch(`/api/events/${eventId}/import/parse`, {
        method: "POST",
        body,
      });
      receive((await response.json()) as ParseResult);
    } catch {
      setFailure("The file never reached the server. Check the connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function parseText(): Promise<void> {
    setBusy(true);
    setFailure(null);
    try {
      const response = await fetch(`/api/events/${eventId}/import/parse`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: pasted }),
      });
      receive((await response.json()) as ParseResult);
    } catch {
      setFailure("The text never reached the server. Check the connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function commit(): Promise<void> {
    if (!table) return;
    setBusy(true);
    setFailure(null);
    try {
      const response = await fetch(`/api/events/${eventId}/import/commit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ table, mapping }),
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        setFailure(body.error ?? "The import did not complete.");
        return;
      }
      router.push(`/events/${eventId}`);
      router.refresh();
    } catch {
      setFailure("The import did not reach the server. Nothing was written.");
    } finally {
      setBusy(false);
    }
  }

  // ── Step one: what did the client bring? ──────────────────────────────────
  if (!table) {
    return (
      <div className="mt-6 max-w-2xl">
        {unreadable && (
          <div className="mb-5 border border-seal/30 bg-sealSoft px-4 py-3">
            <p className="text-[13px] font-medium text-seal">
              {unreadable.filename} could not be read as a grid
            </p>
            <p className="mt-1 text-[13px] leading-relaxed text-ink">
              {unreadable.reason} {unreadable.suggestion}
            </p>
          </div>
        )}

        <div className="border border-rule bg-paper p-6">
          <h2 className="text-[15px] font-medium">Choose the file</h2>
          <p className="mt-1 text-[13px] leading-relaxed text-muted">
            Spreadsheets and CSVs are read directly. A title block above the grid
            is found and reported rather than guessed past.
          </p>
          <input
            ref={fileInput}
            type="file"
            accept=".csv,.tsv,.txt,.tab,.xlsx,.xlsm"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void parseFile(file);
            }}
            className="mt-4 block w-full cursor-pointer border border-rule bg-field px-3 py-2 text-[13px] file:mr-3 file:border-0 file:bg-ink file:px-3 file:py-1.5 file:text-[13px] file:text-white"
          />
        </div>

        <div className="mt-4 border border-rule bg-paper p-6">
          <h2 className="text-[15px] font-medium">
            {unreadable ? "Paste the list instead" : "Or paste the list"}
          </h2>
          <p className="mt-1 text-[13px] leading-relaxed text-muted">
            Anything that is not a spreadsheet comes through here — a Word table,
            an email, a PDF you can select text in. Copy the rows and paste them;
            tabs and commas are both understood.
          </p>
          <textarea
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            rows={6}
            placeholder={"編號\t品名\t作者\t估價\nP01\t青花瓶\t—\t800,000–1,200,000"}
            className="mt-4 w-full border border-rule bg-field px-3 py-2 font-mono text-[12px] leading-relaxed placeholder:text-faint"
          />
          <button
            type="button"
            onClick={() => void parseText()}
            disabled={busy || pasted.trim() === ""}
            className="mt-3 bg-ink px-3 py-1.5 text-[13px] font-medium text-white disabled:opacity-60"
          >
            {busy ? "Reading…" : "Read this text"}
          </button>
        </div>

        {failure && (
          <p className="mt-4 text-[13px] text-seal">{failure}</p>
        )}
      </div>
    );
  }

  // ── Step two: clear the mapping ───────────────────────────────────────────
  const sampleRows = table.rows.slice(0, 3);

  return (
    <div className="mt-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[15px] font-medium">
          Match {table.headers.length} columns
        </h2>
        <p className="text-[12px] text-muted" data-numeric>
          {table.source.filename}
          {table.source.sheetName ? ` · sheet “${table.source.sheetName}”` : ""}
          {` · ${table.rows.length} rows`}
        </p>
      </div>

      {table.source.skippedRows.length > 0 && (
        <p className="mt-2 text-[12px] text-muted">
          Headers were found on row {table.source.headerRow + 1}.{" "}
          <button
            type="button"
            onClick={() => setShowSkipped(!showSkipped)}
            className="underline hover:text-seal"
          >
            {showSkipped ? "Hide" : "Show"} the {table.source.skippedRows.length}{" "}
            rows above them
          </button>
          {showSkipped && (
            <span className="mt-1 block bg-sunk px-3 py-2 font-mono text-[12px] text-ink">
              {table.source.skippedRows
                .map((r) => r.filter(Boolean).join(" · "))
                .join("\n")}
            </span>
          )}
        </p>
      )}

      {table.source.otherSheets && table.source.otherSheets.length > 0 && (
        <p className="mt-2 text-[12px] text-muted">
          Other sheets in this workbook were not read:{" "}
          {table.source.otherSheets.join(", ")}.
        </p>
      )}

      <div className="mt-4 border border-rule bg-paper">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-rule text-left text-[10px] tracking-wide text-muted">
              <th className="w-52 px-4 py-2 font-medium">Their column</th>
              <th className="px-4 py-2 font-medium">What is in it</th>
              <th className="w-56 px-4 py-2 font-medium">Becomes</th>
              <th className="w-64 px-4 py-2 font-medium">Why</th>
            </tr>
          </thead>
          <tbody>
            {table.headers.map((header, column) => {
              const suggestion = suggestions[column];
              const target = mapping[column] ?? { kind: "skip" as const };
              const isSkipped = target.kind === "skip";
              return (
                <tr
                  key={column}
                  className={`border-b border-rule last:border-b-0 ${isSkipped ? "opacity-50" : ""}`}
                >
                  <td className="px-4 py-2.5 align-top font-medium">{header}</td>
                  <td className="max-w-0 px-4 py-2.5 align-top text-muted">
                    <span className="block truncate">
                      {sampleRows
                        .map((r) => r[column])
                        .filter((v) => v && v.trim() !== "")
                        .join(" · ") || (
                        <span className="text-faint">empty</span>
                      )}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 align-top">
                    <select
                      aria-label={`What ${header} becomes`}
                      value={targetToValue(target)}
                      onChange={(e) => {
                        const next = [...mapping];
                        next[column] = valueToTarget(e.target.value, header);
                        setMapping(next);
                      }}
                      className="w-full border border-rule bg-paper px-2 py-1.5 text-[13px]"
                    >
                      {CORE_FIELDS.map((field) => (
                        <option key={field.key} value={`core:${field.key}`}>
                          {field.label.zh} · {field.label.en}
                        </option>
                      ))}
                      <option value="custom">Keep as “{header}”</option>
                      <option value="skip">Do not import</option>
                    </select>
                    {target.kind === "core" && (
                      <p className="mt-1 text-[12px] leading-snug text-faint">
                        {FIELD_HINT.get(target.field)}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-2.5 align-top text-[12px] leading-snug text-muted">
                    {suggestion?.suggested ? (
                      <>
                        <span className="text-ink">
                          {confidenceLabel(suggestion.confidence)}
                        </span>{" "}
                        — {suggestion.reason}
                      </>
                    ) : (
                      "No core field fits, so it is kept under its own name."
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* WHAT IS ABOUT TO BE WRITTEN, before anything is. A proposal is not an
          edit; this is the proposal made legible. */}
      {prepared && (
        <div className="mt-6">
          <h2 className="text-[15px] font-medium">
            {prepared.lots.length} lots will be created
          </h2>
          {prepared.warnings.length > 0 && (
            <ul className="mt-2 space-y-1">
              {prepared.warnings.map((warning) => (
                <li key={warning} className="text-[12px] text-seal">
                  {warning}
                </li>
              ))}
            </ul>
          )}
          {prepared.skippedRows > 0 && (
            <p className="mt-2 text-[12px] text-muted" data-numeric>
              {prepared.skippedRows} rows had nothing in any imported column and
              are not lots.
            </p>
          )}

          <div className="mt-3 overflow-x-auto border border-rule bg-paper">
            <table className="w-full border-collapse text-[12px]">
              <thead>
                <tr className="border-b border-rule text-left text-[10px] text-muted">
                  <th className="px-3 py-1.5 font-medium">Ref</th>
                  {Object.keys(prepared.lots[0]?.fields ?? {})
                    .filter((k) => k !== "ref")
                    .slice(0, 5)
                    .map((key) => (
                      <th key={key} className="px-3 py-1.5 font-medium">
                        {FIELD_LABEL.get(key as CoreFieldKey)?.en ?? key}
                      </th>
                    ))}
                </tr>
              </thead>
              <tbody>
                {prepared.lots.slice(0, 5).map((lot) => (
                  <tr
                    key={lot.sourceRow}
                    className="border-b border-rule last:border-b-0"
                  >
                    <td className="px-3 py-1.5 font-medium" data-numeric>
                      {lot.ref ?? <span className="text-faint">—</span>}
                    </td>
                    {Object.keys(prepared.lots[0]?.fields ?? {})
                      .filter((k) => k !== "ref")
                      .slice(0, 5)
                      .map((key) => (
                        <td
                          key={key}
                          className="max-w-48 truncate px-3 py-1.5 text-muted"
                        >
                          {lot.fields[key] ?? ""}
                        </td>
                      ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-5 flex items-center gap-3">
            <button
              type="button"
              onClick={() => void commit()}
              disabled={busy || prepared.lots.length === 0}
              className="bg-seal px-4 py-2 text-[13px] font-medium text-white hover:bg-sealPress disabled:opacity-60"
            >
              {busy ? "Importing…" : `Import ${prepared.lots.length} lots`}
            </button>
            <button
              type="button"
              onClick={() => {
                setTable(null);
                setMapping([]);
                if (fileInput.current) fileInput.current.value = "";
              }}
              className="text-[13px] text-muted underline hover:text-ink"
            >
              Start again with a different file
            </button>
          </div>

          {failure && <p className="mt-3 text-[13px] text-seal">{failure}</p>}
        </div>
      )}
    </div>
  );
}
