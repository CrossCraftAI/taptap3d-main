// Commit a cleared mapping.
//
// THE SERVER RE-APPLIES THE MAPPING. The browser already ran `applyMapping` to
// show the person what was about to be written, and this runs the same pure
// function again on the same input rather than accepting the lots the browser
// computed. Not because the browser is hostile — it is ours — but because a
// client that can post arbitrary lot rows is a client that decides what the
// database contains, and the screen's promise ("this is exactly what will be
// written") is only true if one function produces both.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { getDb, importRuns } from "@/db";
import { getEvent } from "@/lib/data/events";
import { insertLots } from "@/lib/data/lots";
import { currentOrgId } from "@/lib/data/org";
import { applyMapping, type Mapping } from "@/lib/import/apply";
import { CORE_FIELD_KEYS } from "@/lib/import/fields";
import type { ParsedTable } from "@/lib/import/parse";

export const runtime = "nodejs";

const targetSchema = z.union([
  z.object({ kind: z.literal("core"), field: z.enum(CORE_FIELD_KEYS) }),
  z.object({ kind: z.literal("custom"), name: z.string().min(1).max(200) }),
  z.object({ kind: z.literal("skip") }),
]);

const bodySchema = z.object({
  table: z.object({
    kind: z.literal("table"),
    headers: z.array(z.string()).min(1).max(200),
    rows: z.array(z.array(z.string())).max(20000),
    source: z.object({
      filename: z.string().max(500),
      format: z.enum(["csv", "tsv", "xlsx"]),
      headerRow: z.number().int().min(0),
      skippedRows: z.array(z.array(z.string())).default([]),
      sheetName: z.string().optional(),
      otherSheets: z.array(z.string()).optional(),
    }),
  }),
  mapping: z.array(targetSchema),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const orgId = await currentOrgId();
  const event = await getEvent(orgId, id);
  if (!event) {
    return NextResponse.json({ error: "No such event." }, { status: 404 });
  }

  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "That import could not be read back. Start it again." },
      { status: 400 },
    );
  }

  const { table, mapping } = parsed.data;
  const prepared = applyMapping(table as ParsedTable, mapping as Mapping);

  // THE RUN IS WRITTEN FIRST, AND BOTH WRITES ARE ONE TRANSACTION.
  //
  // It used to be written last, which meant the lots existed before there was
  // anything for them to point at — and once `lots.import_run_id` exists, an
  // order that cannot fill it is an order that throws the answer away. So the
  // run row is inserted for its id, and the lots carry it.
  //
  // The transaction is the other half of that. A run row alone would claim a
  // number of lots that do not exist, which is a provenance record that lies,
  // and lots alone would be exactly the unattributed state this column was
  // added to end. Neither is reachable now: both land, or neither does.
  //
  // `lotCount` is `prepared.lots.length` rather than the insert's own count
  // because it has to be known before the insert runs. They are the same
  // number — `insertLots` writes one row per prepared lot — and the assertion
  // is cheap enough to keep, because a silent disagreement here would be a
  // number in a record whose entire purpose is to be trusted later.
  const written = await getDb().transaction(async (tx) => {
    const [run] = await tx
      .insert(importRuns)
      .values({
        orgId,
        eventId: id,
        sourceFilename: table.source.filename,
        sourceFormat: table.source.format,
        mapping,
        rowCount: table.rows.length,
        lotCount: prepared.lots.length,
        warnings: prepared.warnings,
        // Provenance, not the file. DFD.md §4.3 requires the mapping to cross
        // this boundary; it does not require the customer's spreadsheet, and
        // keeping that would turn a thirty-second decision into a retention
        // policy.
      })
      .returning({ id: importRuns.id });
    // One row in, one row back; the check is here because the type says the
    // array could be empty and a non-null assertion would be a claim rather
    // than a check.
    if (!run) throw new Error("The import run could not be recorded.");
    const count = await insertLots(orgId, id, prepared.lots, {
      importRunId: run.id,
      writer: tx,
    });
    if (count !== prepared.lots.length) {
      throw new Error(
        `Import wrote ${count} lots where ${prepared.lots.length} were prepared.`,
      );
    }
    return count;
  });

  return NextResponse.json({ lotCount: written, warnings: prepared.warnings });
}
