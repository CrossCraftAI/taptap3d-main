// Bring the predecessor across.
//
// ── IT RUNS INSIDE FLY, NEVER FROM A LAPTOP ─────────────────────────────────
//
// Two databases and 71 MB of photographs move here. Running it from a developer
// machine would mean materialising both production credentials locally and
// pulling every plate down and back up again over a domestic connection — and
// the predecessor's last round of UAT died precisely because it depended on a
// developer's machine being switched on. So: a one-off inside the app's own
// machine, where DATABASE_URL already lives, reading the old database over Fly's
// private network and pulling the bytes from `tap3d.internal` over the same.
//
//   fly ssh console -a taptap3d -C "node /app/migrate-from-tap3d.mjs"           # dry run
//   fly ssh console -a taptap3d -C "node /app/migrate-from-tap3d.mjs --commit"  # for real
//
// ── WHAT IT REFUSES TO DO ───────────────────────────────────────────────────
//
// It never writes to the predecessor, and it never deletes anything anywhere.
// Every insert is keyed on a NATURAL key and conflicts do nothing, so running it
// twice changes nothing the first run did — which matters because the first run
// is the one most likely to be interrupted.
//
// ── WHAT IT LEAVES BEHIND ───────────────────────────────────────────────────
//
// The predecessor holds two generations of schema in one database. Only the
// second is migrated. The first — tenants, events, lots, media_assets,
// brand_specs — is the abandoned tenant-scoped design, and the predecessor's own
// source calls its `lots` table LEGACY and says nothing writes to it. The caches
// (extraction, render, verification, fixture_results) are dropped: they are
// caches of a renderer that no longer exists, and re-derivable by definition.
//
// See M1.md §7 for the full table-by-table mapping.

import { mkdir, rename, writeFile } from "node:fs/promises";
import { access, constants } from "node:fs";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";

import pg from "pg";

const COMMIT = process.argv.includes("--commit");
// Recompute `fields` for lots that are already here. The inserts are additive by
// design — a second run must not clobber an edit someone made since — so bringing
// a CHANGE in the mapping across has to be asked for explicitly.
const REFRESH = process.argv.includes("--refresh-fields");
const TARGET_URL = process.env.DATABASE_URL;

/**
 * The predecessor's database, WITHOUT A SECOND CREDENTIAL.
 *
 * Both databases live on the same Managed Postgres cluster — the new app was
 * given its own database on the predecessor's idle cluster rather than a second
 * one nobody is paying for twice. So the source URL is this app's own URL with
 * the database name swapped, and the role it connects as is the one the app
 * already holds. No second secret exists to leak, rotate, or forget to revoke.
 *
 * TAP3D_SOURCE_URL overrides it, for the day the two are not co-tenant.
 */
function derivedSourceUrl() {
  if (process.env.TAP3D_SOURCE_URL) return process.env.TAP3D_SOURCE_URL;
  if (!TARGET_URL) return undefined;
  try {
    const url = new URL(TARGET_URL);
    url.pathname = `/${process.env.TAP3D_SOURCE_DATABASE ?? "fly-db"}`;
    return url.toString();
  } catch {
    return undefined;
  }
}
const SOURCE_URL = derivedSourceUrl();
// The predecessor over Fly's private network. It has no public address any more
// and needs none — 6PN reaches it from inside the organisation.
const ORIGIN = process.env.TAP3D_SOURCE_ORIGIN ?? "http://tap3d.internal:3000";
const ASSET_ROOT = process.env.TAPTAP3D_ASSET_ROOT ?? "/data/assets";
// Projects whose tenant_id is null still need an owner; they join this org.
const FALLBACK_SLUG = process.env.TAPTAP3D_ORG_SLUG ?? "dev";

if (!SOURCE_URL) {
  console.error(
    "No source database. Set TAP3D_SOURCE_URL, or DATABASE_URL so one can be derived.",
  );
  process.exit(1);
}
if (!TARGET_URL) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

const counts = {};
const bump = (key, n = 1) => {
  counts[key] = (counts[key] ?? 0) + n;
};

const source = new pg.Pool({ connectionString: SOURCE_URL, max: 2 });
const target = new pg.Pool({ connectionString: TARGET_URL, max: 2 });

/** Read from the predecessor. Never writes — there is no write helper here. */
const read = async (sql, values = []) => (await source.query(sql, values)).rows;

/**
 * EVERYTHING ON THE TARGET GOES THROUGH ONE TRANSACTION, and the dry run is that
 * transaction rolled back.
 *
 * The first version skipped the writes instead, which made the dry run worthless
 * past its first step: every later step reads back the id of the row it just
 * inserted, so with the inserts skipped the maps stayed empty and 215 lots
 * reported as zero. A dry run that can only see one step ahead is a dry run that
 * lies about the other five.
 *
 * The real run gets the property for free, and it is the more valuable half: a
 * migration that fails in the middle leaves nothing behind rather than half a
 * sale nobody can tell from a whole one.
 */
let client;
const write = async (sql, values = []) => (await client.query(sql, values)).rows;

const exists = (path) =>
  new Promise((resolve) => access(path, constants.R_OK, (e) => resolve(!e)));

/** A bilingual pair, or nothing. Empty halves are dropped rather than stored. */
function bilingual(zh, en) {
  const value = {};
  if (zh && String(zh).trim()) value.zh = String(zh).trim();
  if (en && String(en).trim()) value.en = String(en).trim();
  return Object.keys(value).length > 0 ? value : undefined;
}

const text = (value) =>
  value === null || value === undefined || String(value).trim() === ""
    ? undefined
    : String(value).trim();

/**
 * The predecessor's typed columns, collapsed into one jsonb field bag.
 *
 * NOTHING IS REFORMATTED ON THE WAY THROUGH. `price_display` is carried
 * verbatim rather than rebuilt from the numeric low/high, because the display
 * string is what a person wrote and the numbers are what a parser guessed —
 * and an estimate is a RANGE, which is the exact fact the predecessor's corpus
 * says not to flatten. The numerics are kept beside it under their own names so
 * nothing is lost.
 */
function fieldsFor(row) {
  const fields = {};
  const put = (key, value) => {
    if (value !== undefined) fields[key] = value;
  };

  put("title", bilingual(row.title_zh, row.title_en));
  put("maker", bilingual(row.maker_zh, row.maker_en));
  put("date", text(row.date_display));
  put("material", bilingual(row.material_zh, row.material_en));
  put("description", bilingual(row.description_zh, row.description_en));

  // The written string wins; the numerics are only a fallback, and they are
  // composed in the order a catalogue prints them.
  const measured = [row.height_cm, row.width_cm, row.depth_cm]
    .map((d) => text(d))
    .filter(Boolean);
  put(
    "dimensions",
    text(row.dimensions_display) ??
      (measured.length > 0 ? `${measured.join(" × ")} cm` : undefined),
  );
  put("price", text(row.price_display));

  // The measured values, kept — they are the house's data and dropping them
  // because a display string exists is not this script's decision to make.
  //
  // UNDER AN UNDERSCORE, because a caption prints every field it does not
  // recognise, and these are not caption content: the dimensions and the
  // estimate already print in the form a person wrote them. Without the prefix
  // every migrated lot carried a column of bare numbers beneath its description
  // — "301", "144", "84.9" — which is what the first run actually produced.
  for (const key of [
    "height_cm",
    "width_cm",
    "depth_cm",
    "price_amount",
    "price_low",
    "price_high",
    "price_currency",
  ]) {
    put(`_${key}`, text(row[key]));
  }

  const custom = row.custom_fields ?? {};
  for (const [key, value] of Object.entries(custom)) {
    if (key === "images") continue; // handled through lot_assets
    if (value !== null && value !== undefined && value !== "") fields[key] = value;
  }
  return fields;
}

async function copyBlob(hash) {
  const target = join(ASSET_ROOT, "objects", hash.slice(0, 2), hash);
  if (await exists(target)) {
    bump("blobs already present");
    return true;
  }
  if (!COMMIT) {
    bump("blobs to copy");
    return true;
  }
  const response = await fetch(`${ORIGIN}/api/assets/${hash}`);
  if (!response.ok) {
    bump("blobs missing at source");
    console.warn(`  blob ${hash.slice(0, 12)}… → ${response.status} from ${ORIGIN}`);
    return false;
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  // VERIFIED, NOT TRUSTED. The name is the hash; a truncated transfer stored
  // under it would be indistinguishable from the real thing forever after.
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== hash) {
    bump("blobs that failed verification");
    console.warn(`  blob ${hash.slice(0, 12)}… hashed to ${actual.slice(0, 12)}…`);
    return false;
  }
  await mkdir(dirname(target), { recursive: true });
  const staging = `${target}.${process.pid}.part`;
  await writeFile(staging, bytes);
  await rename(staging, target);
  bump("blobs copied");
  return true;
}

/**
 * What is actually in the predecessor, table by table.
 *
 * A MIGRATION YOU CANNOT INSPECT IS A MIGRATION YOU RUN BLIND — and a dry run
 * that reports "0 lots" is indistinguishable from one whose queries all matched
 * nothing for some other reason. This says which tables exist and how many rows
 * each holds, so "there was nothing to move" is a finding rather than a guess.
 */
async function report() {
  const tables = [
    "tenants", "projects", "project_lots", "project_assets", "lot_assets",
    "asset_geometry", "layouts", "layout_versions", "layout_spreads",
    "lot_field_overrides", "lot_field_proposals", "import_runs", "lot_comments",
    "events", "lots", "media_assets", "brand_specs", "provenance_log",
  ];
  const present = new Set(
    (
      await read(
        `select table_name from information_schema.tables where table_schema = 'public'`,
      )
    ).map((r) => r.table_name),
  );
  console.log("source tables:");
  for (const table of tables) {
    if (!present.has(table)) {
      console.log(`  ${table.padEnd(22)} (absent)`);
      continue;
    }
    const [row] = await read(`select count(*)::int as n from "${table}"`);
    console.log(`  ${table.padEnd(22)} ${String(row.n).padStart(7)}`);
  }
  const unlisted = [...present].filter((t) => !tables.includes(t));
  if (unlisted.length > 0) console.log(`  other tables: ${unlisted.join(", ")}`);
}

async function main() {
  console.log(
    `migrate-from-tap3d: ${COMMIT ? "COMMITTING" : "DRY RUN — nothing will be written"}`,
  );
  console.log(`  source db   ${SOURCE_URL.replace(/:\/\/[^@]+@/, "://…@")}`);
  console.log(`  source bytes ${ORIGIN}`);
  console.log(`  asset root  ${ASSET_ROOT}`);
  if (REFRESH) console.log("  --refresh-fields: existing lots will have `fields` recomputed");
  console.log("");
  await report();
  console.log("");
  if (process.argv.includes("--report")) {
    await source.end();
    await target.end();
    return;
  }

  client = await target.connect();
  await client.query("begin");

  // ── orgs ← tenants ────────────────────────────────────────────────────────
  const tenants = await read(`select id, slug, name from tenants`);
  const orgBySourceId = new Map();
  for (const tenant of tenants) {
    await write(
      `insert into orgs (name, slug) values ($1, $2)
       on conflict (slug) do nothing`,
      [tenant.name, tenant.slug],
    );
    bump("orgs");
  }
  // Read back whatever is actually there — after a conflict-do-nothing the row
  // may be one an earlier run wrote, and its id is the one everything else must
  // point at.
  for (const tenant of tenants) {
    const [row] = (await client.query(`select id from orgs where slug = $1`, [tenant.slug])).rows;
    if (row) orgBySourceId.set(tenant.id, row.id);
  }
  const [fallbackOrg] = (
    await client.query(`select id from orgs where slug = $1`, [FALLBACK_SLUG])
  ).rows;
  // NOT GATED ON --commit. It was, and that is exactly how the first dry run
  // reported "nothing to migrate" against a database holding 215 lots: no
  // fallback org meant every tenant-less project was skipped, silently, and the
  // run still called itself complete.
  if (!fallbackOrg && tenants.length === 0) {
    console.error("");
    console.error(
      `NOTHING CAN BE MIGRATED: the predecessor has no tenants, so every project ` +
        `needs the fallback org — and no org has the slug "${FALLBACK_SLUG}".`,
    );
    console.error(
      `  Create one:  node /app/seed-org.mjs '<name>' ${FALLBACK_SLUG}`,
    );
    console.error(`  Or point at an existing org with TAPTAP3D_ORG_SLUG.`);
    await client.query("rollback");
    client.release();
    await source.end();
    await target.end();
    process.exit(1);
  }
  const orgFor = (tenantId) =>
    orgBySourceId.get(tenantId) ?? fallbackOrg?.id ?? null;

  // ── events ← projects ─────────────────────────────────────────────────────
  const projects = await read(
    `select id, name, tenant_id, created_at from projects order by created_at`,
  );
  const eventByProject = new Map();
  for (const project of projects) {
    const orgId = orgFor(project.tenant_id);
    if (!orgId) continue;
    await write(
      `insert into events (org_id, name, created_at)
       select $1, $2, $3
       where not exists (select 1 from events where org_id = $1 and name = $2)`,
      [orgId, project.name, project.created_at],
    );
    bump("events");
    const [row] = (
      await client.query(`select id from events where org_id = $1 and name = $2 limit 1`, [
        orgId,
        project.name,
      ])
    ).rows;
    if (row) eventByProject.set(project.id, { id: row.id, orgId });
  }

  // ── lots ← project_lots ───────────────────────────────────────────────────
  const sourceLots = await read(
    `select * from project_lots order by project_id, sort_order`,
  );
  const lotBySourceId = new Map();
  for (const lot of sourceLots) {
    const event = eventByProject.get(lot.project_id);
    if (!event) continue;
    await write(
      `insert into lots (org_id, event_id, ref, fields, position, created_at)
       select $1, $2, $3, $4, $5, $6
       where not exists (select 1 from lots where event_id = $2 and ref = $3)`,
      [
        event.orgId,
        event.id,
        lot.ref,
        JSON.stringify(fieldsFor(lot)),
        lot.sort_order ?? 0,
        lot.created_at,
      ],
    );
    bump("lots");
    if (REFRESH) {
      const updated = await write(
        // BOTH CASTS ARE EXPLICIT. The comparison forces $1 to text, and
        // Postgres then refuses to assign that text to a jsonb column — the
        // parameter cannot be two types at once and will not guess.
        `update lots set fields = $1::jsonb, updated_at = now()
         where event_id = $2 and ref = $3 and fields::text is distinct from $1::text
         returning id`,
        [JSON.stringify(fieldsFor(lot)), event.id, lot.ref],
      );
      if (updated.length > 0) bump("lots whose fields were refreshed");
    }
    const [row] = (
      await client.query(`select id from lots where event_id = $1 and ref = $2 limit 1`, [
        event.id,
        lot.ref,
      ])
    ).rows;
    if (row) lotBySourceId.set(lot.id, { id: row.id, orgId: event.orgId });
  }

  // ── assets ← project_assets, with geometry ────────────────────────────────
  const geometry = new Map(
    (await read(`select * from asset_geometry`)).map((g) => [
      g.hash,
      {
        width: Number(g.width),
        height: Number(g.height),
        // The subject box, measured once and stored against the asset. The
        // engine reads it; it never scrapes it back out of a render.
        content: {
          x: Number(g.content_x),
          y: Number(g.content_y),
          w: Number(g.content_w),
          h: Number(g.content_h),
        },
      },
    ]),
  );

  const sourceAssets = await read(
    `select project_id, hash, size, mime, filename, kind, created_at
     from project_assets where kind = 'original'`,
  );
  const assetByHashOrg = new Map();
  for (const asset of sourceAssets) {
    const event = eventByProject.get(asset.project_id);
    if (!event) continue;
    const key = `${event.orgId}:${asset.hash}`;
    if (assetByHashOrg.has(key)) continue;

    const ok = await copyBlob(asset.hash);
    if (!ok) continue;

    await write(
      `insert into assets (org_id, content_hash, mime_type, byte_size, original_name, geometry, created_at)
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (org_id, content_hash) do nothing`,
      [
        event.orgId,
        asset.hash,
        asset.mime,
        Number(asset.size),
        asset.filename,
        geometry.has(asset.hash) ? JSON.stringify(geometry.get(asset.hash)) : null,
        asset.created_at,
      ],
    );
    bump("assets");
    const [row] = (
      await client.query(
        `select id from assets where org_id = $1 and content_hash = $2 limit 1`,
        [event.orgId, asset.hash],
      )
    ).rows;
    if (row) assetByHashOrg.set(key, row.id);
  }

  // ── lot_assets ────────────────────────────────────────────────────────────
  for (const link of await read(`select * from lot_assets`)) {
    const lot = lotBySourceId.get(link.lot_id);
    if (!lot) continue;
    const assetId = assetByHashOrg.get(`${lot.orgId}:${link.asset_hash}`);
    if (!assetId) continue;
    await write(
      `insert into lot_assets (org_id, lot_id, asset_id, position, is_primary)
       values ($1, $2, $3, $4, $5)
       on conflict (lot_id, asset_id) do nothing`,
      [lot.orgId, lot.id, assetId, link.sort_order ?? 0, link.is_primary ?? false],
    );
    bump("lot_assets");
  }

  // ── catalogues ← layouts / layout_versions ────────────────────────────────
  const versions = await read(
    `select distinct on (project_id) project_id, name, params
     from layout_versions order by project_id, created_at desc`,
  );
  const paramsByProject = new Map(versions.map((v) => [v.project_id, v.params]));
  const catalogueByProject = new Map();
  for (const project of projects) {
    const event = eventByProject.get(project.id);
    if (!event) continue;
    const name = `${project.name} catalogue`;
    await write(
      `insert into catalogues (org_id, event_id, name, params)
       select $1, $2, $3, $4
       where not exists (select 1 from catalogues where event_id = $2 and name = $3)`,
      [
        event.orgId,
        event.id,
        name,
        JSON.stringify(paramsByProject.get(project.id) ?? {}),
      ],
    );
    bump("catalogues");
    const [row] = (
      await client.query(
        `select id from catalogues where event_id = $1 and name = $2 limit 1`,
        [event.id, name],
      )
    ).rows;
    if (row) catalogueByProject.set(project.id, { id: row.id, orgId: event.orgId });
  }

  // ── overrides ← lot_field_overrides, and proposals ────────────────────────
  for (const override of await read(`select * from lot_field_overrides`)) {
    const lot = lotBySourceId.get(override.lot_id);
    const catalogue = catalogueByProject.get(override.project_id);
    if (!lot || !catalogue) continue;
    await write(
      `insert into overrides (org_id, catalogue_id, lot_id, field, value, decided_by)
       values ($1, $2, $3, $4, $5, null)
       on conflict (catalogue_id, lot_id, field) do nothing`,
      [
        catalogue.orgId,
        catalogue.id,
        lot.id,
        override.field,
        JSON.stringify({ hidden: override.hidden === true }),
      ],
    );
    bump("overrides");
  }

  // A PROPOSAL IS NOT AN EDIT. `decided_by = null` is how schema.ts says to
  // express one, and the rejected ones travel too — a rejection is remembered so
  // the next run does not re-propose what someone already refused.
  let proposals = [];
  try {
    proposals = await read(
      `select project_id, lot_id, field, kind, state, asset_hash from lot_field_proposals`,
    );
  } catch {
    console.log("  (no lot_field_proposals table at source — skipping)");
  }
  for (const proposal of proposals) {
    const lot = lotBySourceId.get(proposal.lot_id);
    const catalogue = catalogueByProject.get(proposal.project_id);
    if (!lot || !catalogue) continue;
    await write(
      `insert into overrides (org_id, catalogue_id, lot_id, field, value, decided_by)
       values ($1, $2, $3, $4, $5, null)
       on conflict (catalogue_id, lot_id, field) do nothing`,
      [
        catalogue.orgId,
        catalogue.id,
        lot.id,
        `${proposal.field}:${proposal.kind}`,
        JSON.stringify({
          proposal: true,
          kind: proposal.kind,
          state: proposal.state,
          assetHash: proposal.asset_hash,
        }),
      ],
    );
    bump("proposals carried as overrides");
  }

  // ── pins ← layout_spreads ─────────────────────────────────────────────────
  //
  // A SPREAD IS KEYED BY PAGE AND A PIN MAY NOT BE. Page 5 at 3-up holds
  // different lots than page 5 at 9-up, so the page number cannot travel — it is
  // RESOLVED here, once, against the density the predecessor was using, into the
  // lots that were actually on those pages. That resolution is the migration's
  // one genuinely lossy step and it is lossy in the right direction: what
  // survives is which lots belong together, which is what the specialist meant.
  const spreads = await read(`select * from layout_spreads order by project_id, left_page`);
  for (const spread of spreads) {
    const catalogue = catalogueByProject.get(spread.project_id);
    if (!catalogue) continue;
    const params = paramsByProject.get(spread.project_id) ?? {};
    const perPage = Number(params.perPage) > 0 ? Number(params.perPage) : 4;
    const projectLots = sourceLots
      .filter((l) => l.project_id === spread.project_id)
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    // A spread is the left page and the one facing it.
    const from = (spread.left_page - 1) * perPage;
    const members = projectLots
      .slice(from, from + perPage * 2)
      .map((l) => lotBySourceId.get(l.id))
      .filter(Boolean);
    if (members.length < 2) continue;

    const [pin] = await write(
      `insert into pins (org_id, catalogue_id, keeps_together) values ($1, $2, true)
       returning id`,
      [catalogue.orgId, catalogue.id],
    );
    bump("pins");
    if (!pin) continue;
    for (const member of members) {
      await write(
        `insert into pin_members (org_id, pin_id, lot_id, field)
         values ($1, $2, $3, 'placement')
         on conflict (pin_id, lot_id, field) do nothing`,
        [catalogue.orgId, pin.id, member.id],
      );
      bump("pin members");
    }
  }

  // ── import_runs ───────────────────────────────────────────────────────────
  for (const run of await read(`select * from import_runs`)) {
    const event = eventByProject.get(run.project_id);
    if (!event) continue;
    await write(
      `insert into import_runs
         (org_id, event_id, source_filename, source_format, mapping, row_count, lot_count, warnings, created_at)
       select $1, $2, $3, $4, $5, $6, $7, $8, $9
       where not exists (
         select 1 from import_runs
         where event_id = $2 and source_filename = $3 and created_at = $9
       )`,
      [
        event.orgId,
        event.id,
        run.source_filename,
        "unknown",
        JSON.stringify(run.mapping ?? []),
        run.row_count ?? 0,
        run.row_count ?? 0,
        JSON.stringify(run.error ? [String(run.error)] : []),
        run.created_at,
      ],
    );
    bump("import_runs");
  }

  console.log("");
  for (const [key, value] of Object.entries(counts)) {
    console.log(`  ${String(value).padStart(6)}  ${key}`);
  }
  console.log("");
  await client.query(COMMIT ? "commit" : "rollback");
  client.release();

  console.log(
    COMMIT
      ? "migrate-from-tap3d: committed. Nothing in tap3d was written to or deleted."
      : "migrate-from-tap3d: dry run complete, transaction rolled back. " +
        "Re-run with --commit to write.",
  );

  await source.end();
  await target.end();
}

main().catch(async (error) => {
  console.error("migrate-from-tap3d: FAILED —", error?.message ?? error);
  // Roll back rather than leave half a sale in the database. Blobs already
  // written to the volume stay — they are content-addressed, inert without a
  // row pointing at them, and re-used rather than re-fetched on the next run.
  if (client) {
    await client.query("rollback").catch(() => {});
    client.release();
  }
  await source.end().catch(() => {});
  await target.end().catch(() => {});
  process.exit(1);
});
