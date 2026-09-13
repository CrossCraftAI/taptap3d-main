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

  const written = await insertLots(orgId, id, prepared.lots);

  // Provenance, not the file. DFD.md §4.3 requires the mapping to cross this
  // boundary; it does not require the customer's spreadsheet, and keeping that
  // would turn a thirty-second decision into a retention policy.
  await getDb()
    .insert(importRuns)
    .values({
      orgId,
      eventId: id,
      sourceFilename: table.source.filename,
      sourceFormat: table.source.format,
      mapping,
      rowCount: table.rows.length,
      lotCount: written,
      warnings: prepared.warnings,
    });

  return NextResponse.json({ lotCount: written, warnings: prepared.warnings });
}
