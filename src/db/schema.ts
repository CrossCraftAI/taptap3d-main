// The schema. Every rule it embodies is stated in ARCHITECTURE.md; the reasons
// that are specific to a column are stated here, next to the column.
//
// ── org_id ON EVERY ROW, FROM THE FIRST COMMIT ──────────────────────────────
//
// Not because tenancy ships at M0 — it does not, and there is no login yet —
// but because retrofitting it means touching every table, every query and every
// route. Doing it now is nearly free; doing it in year two is a rewrite. A test
// walks this file and fails if a table is added without it.
//
// ── WHAT IS NOT HERE ────────────────────────────────────────────────────────
//
// No condition report, no warehouse location, no listing, no logistics. DFD.md
// names them; they get a table the day someone performs that work in the system.
// Empty tables shipped in advance are a promise the schema cannot keep.

import { relations, sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/** Shared by every table. Defined once so "every row" is literally true. */
const rowBase = {
  id: uuid("id").defaultRandom().primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
};

// ── Identity and tenancy ────────────────────────────────────────────────────

export const orgs = pgTable("orgs", {
  ...rowBase,
  // The tenant. Named `org` rather than `house` or `tenant`: the product's
  // long-term scope is any physical business, and "auction house" is a fact
  // about the first vertical rather than about the model.
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
});

export const users = pgTable("users", {
  ...rowBase,
  email: text("email").notNull().unique(),
  name: text("name"),
  // No password column, no session table, no provider id. The identity system
  // is deferred (ROADMAP D14) and this row exists so that everything which
  // references a person has something to reference. Adding auth adds columns
  // here; it does not reshape anything that points at this table.
});

export const memberRole = pgEnum("member_role", ["owner", "admin", "member"]);

export const memberships = pgTable(
  "memberships",
  {
    ...rowBase,
    orgId: uuid("org_id")
      .references(() => orgs.id, { onDelete: "cascade" })
      .notNull(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    role: memberRole("role").default("member").notNull(),
  },
  (t) => [uniqueIndex("memberships_org_user").on(t.orgId, t.userId)],
);

// ── The cycle's objects ─────────────────────────────────────────────────────

export const events = pgTable(
  "events",
  {
    ...rowBase,
    orgId: uuid("org_id")
      .references(() => orgs.id, { onDelete: "cascade" })
      .notNull(),
    // The top-level object a user creates. `event`, not `sale`: an auction is an
    // event and so is a gallery show, a collection launch, a retail drop. The UI
    // is free to call it 專案 or project; what the table is called and what the
    // user reads need not match, and the generic name is what stops the second
    // vertical requiring a migration.
    name: text("name").notNull(),
    // When the sale/show happens, if it is known. Nullable because a catalogue
    // is often in production long before a date is fixed.
    heldOn: timestamp("held_on", { withTimezone: true }),
  },
  (t) => [index("events_org").on(t.orgId)],
);

export const lots = pgTable(
  "lots",
  {
    ...rowBase,
    orgId: uuid("org_id")
      .references(() => orgs.id, { onDelete: "cascade" })
      .notNull(),
    eventId: uuid("event_id")
      .references(() => events.id, { onDelete: "cascade" })
      .notNull(),
    // The house's own reference — "P04", "Lot 23". Theirs, not ours, and not
    // assumed unique: imported data is imported data.
    ref: text("ref"),
    // Field values as imported and edited, keyed by field name. jsonb rather
    // than columns because the field set is the CUSTOMER'S, discovered at import
    // time by the matching screen, and a column per field would make every new
    // client a migration.
    fields: jsonb("fields").$type<Record<string, unknown>>().default({}).notNull(),
    // Order within the event, as the house intends it to appear.
    position: integer("position").default(0).notNull(),
  },
  (t) => [
    index("lots_org").on(t.orgId),
    index("lots_event").on(t.eventId, t.position),
  ],
);

export const assets = pgTable(
  "assets",
  {
    ...rowBase,
    // ORG-SCOPED EVEN THOUGH THE BYTES ARE CONTENT-ADDRESSED, and that is the
    // whole point. Two orgs uploading the same photograph get two rows pointing
    // at one blob: deduplication happens in the storage layer, where it saves
    // space, and never in the table, where it would let one house's row be
    // reachable from another house's query. The predecessor shared a store
    // globally by hash and had to reason carefully about what that leaked.
    orgId: uuid("org_id")
      .references(() => orgs.id, { onDelete: "cascade" })
      .notNull(),
    contentHash: text("content_hash").notNull(),
    mimeType: text("mime_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    originalName: text("original_name"),
    // Measured once and stored against the asset, never scraped from a render —
    // ARCHITECTURE.md, "the engine never reads rendered output". Shape is left
    // open at M0 because what gets measured arrives with the editor at M1.
    geometry: jsonb("geometry").$type<Record<string, unknown>>(),
  },
  (t) => [
    index("assets_org").on(t.orgId),
    uniqueIndex("assets_org_hash").on(t.orgId, t.contentHash),
  ],
);

export const lotAssets = pgTable(
  "lot_assets",
  {
    ...rowBase,
    orgId: uuid("org_id")
      .references(() => orgs.id, { onDelete: "cascade" })
      .notNull(),
    lotId: uuid("lot_id")
      .references(() => lots.id, { onDelete: "cascade" })
      .notNull(),
    assetId: uuid("asset_id")
      .references(() => assets.id, { onDelete: "cascade" })
      .notNull(),
    position: integer("position").default(0).notNull(),
    isPrimary: boolean("is_primary").default(false).notNull(),
  },
  (t) => [
    index("lot_assets_org").on(t.orgId),
    uniqueIndex("lot_assets_pair").on(t.lotId, t.assetId),
  ],
);

export const catalogues = pgTable(
  "catalogues",
  {
    ...rowBase,
    orgId: uuid("org_id")
      .references(() => orgs.id, { onDelete: "cascade" })
      .notNull(),
    // A CHILD of an event, not the event itself. This is what makes the awkward
    // real cases expressible without a migration: one catalogue spanning two
    // sessions, a re-issue, or an event that never produces one.
    eventId: uuid("event_id")
      .references(() => events.id, { onDelete: "cascade" })
      .notNull(),
    name: text("name").notNull(),
    // Layout parameters — density, placement, margins. jsonb at M0 because the
    // engine that reads them does not exist yet, and inventing its columns now
    // would be inventing its design.
    params: jsonb("params").$type<Record<string, unknown>>().default({}).notNull(),
  },
  (t) => [index("catalogues_event").on(t.eventId)],
);

// ── Corrections, and the arrangements that must survive re-derivation ───────

export const overrides = pgTable(
  "overrides",
  {
    ...rowBase,
    orgId: uuid("org_id")
      .references(() => orgs.id, { onDelete: "cascade" })
      .notNull(),
    catalogueId: uuid("catalogue_id")
      .references(() => catalogues.id, { onDelete: "cascade" })
      .notNull(),
    // KEYED (lot, field) AND NEVER BY ELEMENT ID. ARCHITECTURE.md principle 1:
    // element ids are positional — the same lot is p5-s1 at 4-up and p2-s3 at
    // 9-up — so anything keyed to one is destroyed by a density change. This
    // keying is what lets a year of human judgement survive a repagination.
    lotId: uuid("lot_id")
      .references(() => lots.id, { onDelete: "cascade" })
      .notNull(),
    field: text("field").notNull(),
    // The correction itself: a frame, an angle, a colour axis. jsonb at M0
    // because the value shape belongs to the editor, which lands at M1. It is a
    // VALUE the engine re-applies, never rendered output — principle 2.
    value: jsonb("value").$type<Record<string, unknown>>().default({}).notNull(),
    // Who said so. Null means the machine proposed it and nobody has confirmed.
    // A proposal is not an edit (principle 9), and provenance is derived by
    // comparison rather than by a flag that a restore could make lie.
    //
    // BEFORE SIGN-IN EXISTS, a human decision is written as the org's GATE
    // IDENTITY — one `users` row per org, `gate@<slug>.taptap3d.invalid`, made
    // on first use by src/lib/data/actor.ts. Writing null "because there is no
    // user yet" would have made every human decision read as an unconfirmed
    // proposal the day the vision model starts proposing, which is the one
    // thing this column exists to prevent. The engine applies rows with a
    // decider and skips the rest.
    decidedBy: uuid("decided_by").references(() => users.id, {
      onDelete: "set null",
    }),
  },
  (t) => [
    index("overrides_org").on(t.orgId),
    uniqueIndex("overrides_scope").on(t.catalogueId, t.lotId, t.field),
  ],
);

export const pins = pgTable(
  "pins",
  {
    ...rowBase,
    orgId: uuid("org_id")
      .references(() => orgs.id, { onDelete: "cascade" })
      .notNull(),
    catalogueId: uuid("catalogue_id")
      .references(() => catalogues.id, { onDelete: "cascade" })
      .notNull(),
    // Whether the pin also constrains PAGINATION — i.e. whether its members must
    // stay on one page. Left explicit because the collision case (re-derivation
    // would split a pinned group) has two defensible answers and the system must
    // not pick silently.
    keepsTogether: boolean("keeps_together").default(true).notNull(),
  },
  (t) => [index("pins_catalogue").on(t.catalogueId)],
);

export const pinMembers = pgTable(
  "pin_members",
  {
    ...rowBase,
    orgId: uuid("org_id")
      .references(() => orgs.id, { onDelete: "cascade" })
      .notNull(),
    pinId: uuid("pin_id")
      .references(() => pins.id, { onDelete: "cascade" })
      .notNull(),
    // A PIN IS KEYED BY ITS MEMBERS, NEVER BY PAGE INDEX. A page number is as
    // positional as an element id: page 5 at 3-up holds different lots than page
    // 5 at 9-up, so a pin keyed to "page 5" lands on unrelated content the moment
    // density moves. Keyed to (lot, field) — the same keying as an override — it
    // survives.
    lotId: uuid("lot_id")
      .references(() => lots.id, { onDelete: "cascade" })
      .notNull(),
    field: text("field").notNull(),
  },
  (t) => [
    index("pin_members_org").on(t.orgId),
    uniqueIndex("pin_members_unique").on(t.pinId, t.lotId, t.field),
  ],
);

// ── Provenance of an import ─────────────────────────────────────────────────

export const importRuns = pgTable(
  "import_runs",
  {
    ...rowBase,
    orgId: uuid("org_id")
      .references(() => orgs.id, { onDelete: "cascade" })
      .notNull(),
    eventId: uuid("event_id")
      .references(() => events.id, { onDelete: "cascade" })
      .notNull(),
    // The name of the file the client brought, and nothing else about it. DFD.md
    // §4.3 requires the PROVENANCE OF THE MAPPING to cross the import → lots
    // boundary; it does not require the file, and the file is the customer's
    // property and frequently their copyright. Keeping it would turn a
    // thirty-second decision into a retention policy.
    sourceFilename: text("source_filename").notNull(),
    sourceFormat: text("source_format").notNull(),
    // The mapping AS A HUMAN CLEARED IT — one target per column, positionally.
    // This is the answer to "why is this lot's maker in the title field", asked
    // three weeks later about a file nobody still has.
    mapping: jsonb("mapping").$type<unknown[]>().default([]).notNull(),
    rowCount: integer("row_count").default(0).notNull(),
    // How many of the parsed rows became lots. Differs from rowCount when rows
    // were skipped for having nothing in any mapped column.
    lotCount: integer("lot_count").default(0).notNull(),
    // Warnings shown to the person before they committed. Stored because "it
    // warned me and I went ahead" and "it never told me" are different facts.
    warnings: jsonb("warnings").$type<string[]>().default([]).notNull(),
  },
  (t) => [
    index("import_runs_org").on(t.orgId),
    index("import_runs_event").on(t.eventId),
  ],
);

// ── The instrument ──────────────────────────────────────────────────────────

export const actionLog = pgTable(
  "action_log",
  {
    ...rowBase,
    orgId: uuid("org_id")
      .references(() => orgs.id, { onDelete: "cascade" })
      .notNull(),
    // NOT ANALYTICS. This is the instrument that decides whether a new catalogue
    // arrives derived or blank, by counting the actions required to reach the
    // same result from each starting point (ARCHITECTURE.md principle 3, and
    // ROADMAP D9). The measurement cannot be retrofitted: if gestures are not
    // counted from the beginning, the experiment is unrunnable when the question
    // arrives. That is the whole reason this table exists at M0, before there is
    // anything to log.
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    catalogueId: uuid("catalogue_id").references(() => catalogues.id, {
      onDelete: "cascade",
    }),
    // Groups gestures into one sitting, so "how many actions did this take" is
    // answerable. Client-generated; it identifies a stretch of work, not a login.
    sessionId: uuid("session_id").notNull(),
    // Monotonic within a session. Ordering by timestamp alone loses gestures
    // that land inside the same millisecond, which is exactly what a drag does.
    seq: integer("seq").notNull(),
    action: text("action").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().default({}).notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (t) => [
    index("action_log_org").on(t.orgId),
    uniqueIndex("action_log_session_seq").on(t.sessionId, t.seq),
  ],
);

// ── Relations ───────────────────────────────────────────────────────────────

export const orgsRelations = relations(orgs, ({ many }) => ({
  memberships: many(memberships),
  events: many(events),
  assets: many(assets),
}));

export const eventsRelations = relations(events, ({ one, many }) => ({
  org: one(orgs, { fields: [events.orgId], references: [orgs.id] }),
  lots: many(lots),
  catalogues: many(catalogues),
}));

export const lotsRelations = relations(lots, ({ one, many }) => ({
  event: one(events, { fields: [lots.eventId], references: [events.id] }),
  assets: many(lotAssets),
  overrides: many(overrides),
}));

export const cataloguesRelations = relations(catalogues, ({ one, many }) => ({
  event: one(events, {
    fields: [catalogues.eventId],
    references: [events.id],
  }),
  overrides: many(overrides),
  pins: many(pins),
}));

export const pinsRelations = relations(pins, ({ one, many }) => ({
  catalogue: one(catalogues, {
    fields: [pins.catalogueId],
    references: [catalogues.id],
  }),
  members: many(pinMembers),
}));
