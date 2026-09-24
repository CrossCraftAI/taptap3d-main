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
// No listing, no logistics, no money. DFD.md names them; they get a table the
// day someone performs that work in the system. Empty tables shipped in advance
// are a promise the schema cannot keep.
//
// The condition report and the warehouse location USED to be on that list, and
// they came off it the day a person could perform either one here: `movements`
// and `examinations` below arrive with the two screens that write them, not
// ahead of them. The same rule explains what those tables do NOT carry — see
// each one's own note.

import { relations, sql } from "drizzle-orm";
import {
  boolean,
  doublePrecision,
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
  // WHICH OF THE HOUSE'S FIELDS MAY LEAVE THE BUILDING — a field key against
  // one of three named levels, `public | internal | house`
  // (src/lib/engine/visibility.ts). The engine drops a field the output's
  // audience does not permit, so this column is the only thing standing between
  // a reserve typed into the record and a reserve on the printed page.
  //
  // NULLABLE, WITH NO DEFAULT, and that is the whole of the compatibility
  // story: null means the house has said nothing, every field is public, and an
  // org row written before this column existed prints exactly what it printed
  // yesterday. `policyFor` is total over anything in here for the same reason
  // `templateFor` and `workflowFor` are — nothing has to be backfilled and
  // nothing has to be migrated when a house changes its mind.
  //
  // ON THE ORG AND NOT ON THE FIELD SET. There is no `fields` table: a lot's
  // field set is the customer's, discovered at import (see `lots.fields`), so
  // the only place an answer about "the field called 底價" can live is beside
  // the tenant that named it. Per-lot was rejected in visibility.ts's header —
  // it would make every newly imported lot's reserve public until somebody
  // remembered, which is the one direction this must never fail in.
  //
  // jsonb rather than a `field_visibility` table, on the same rule the rest of
  // this file follows: a table arrives with its first writer. Nothing authors
  // this inside the system yet, and a key-value pair per tenant is not a
  // relation anybody queries across.
  fieldPolicy: jsonb("field_policy").$type<Record<string, unknown>>(),
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
    // WHERE THE SALE IS, AS A PERSON SAID IT — or null, which is the usual
    // value and means "as the data says". The stage is DERIVED from facts the
    // system already counts (src/lib/workflow.ts): lots, photographs, a
    // catalogue, an export. This column is the exception that wins over the
    // derivation and is remembered (ARCHITECTURE.md principle 3, "derived by
    // default, pinned by exception"; principle 9, "a default, not a lock").
    //
    // A stage ID as text, not an enum and not an index: the built-in workflow
    // is one of what will be several, and a house-authored one names its own
    // stages. An id the current workflow does not have is not an error — the
    // reading falls back to the derived stage — so nothing has to be migrated
    // when a workflow changes under a stored answer.
    //
    // Rejected: a `status` column the application writes as work happens. That
    // is a second source of truth for facts the tables already hold, and it
    // drifts the first time a lot is deleted or a photograph detached.
    stageOverride: text("stage_override"),
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
    // WHEN THE PDF WAS LAST TAKEN. Null until it has been. Written by the print
    // route on a successful render and nowhere else — it records that a thing
    // happened, the way a download counter does; it says nothing about the
    // document, which is why it does not bump `updated_at` (that key reloads
    // the preview and remounts the pin panel, and an export changes neither).
    //
    // It exists because the workflow (src/lib/workflow.ts) reads "an export
    // taken" as a fact about the sale, and before this column nothing in the
    // system knew whether a catalogue had ever left the building. DFD.md §2:
    // a fact gets a column the day someone performs the work here — and the
    // PDF route is that work being performed.
    exportedAt: timestamp("exported_at", { withTimezone: true }),
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

// ── Custody: where a thing is, and how it got there ─────────────────────────

export const movements = pgTable(
  "movements",
  {
    ...rowBase,
    orgId: uuid("org_id")
      .references(() => orgs.id, { onDelete: "cascade" })
      .notNull(),
    lotId: uuid("lot_id")
      .references(() => lots.id, { onDelete: "cascade" })
      .notNull(),
    // ── THERE IS NO `location` COLUMN ON `lots`, AND THAT IS THE POINT ───────
    //
    // Where a lot IS is the last movement's `to_place` — derived, on every
    // read, from the rows below (src/lib/data/movements.ts, `whereItIs`). That
    // is ARCHITECTURE.md principle 2: nothing stored that the engine cannot
    // re-derive. The consequence a registrar feels is that CORRECTING a
    // location appends another movement rather than editing a field, so the
    // wrong answer and the right one are both still in the chain and the
    // catalogue can still be asked which of them was public.
    //
    // Rejected: `lots.current_place`, written alongside each movement. It is
    // one column and it is a second source of truth for a fact these rows
    // already hold; it drifts the first time a movement is deleted or its date
    // corrected, and the drift is invisible — the lot page would say Kwai Chung
    // and the chain would say the saleroom, with nothing to say which lied.
    // Rejected: a `places` table. A place is a string a house types, the same
    // way `lots.ref` is; a table of them is a vocabulary nobody authors yet,
    // and DFD.md §2 refuses an empty table shipped in advance.
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
    // WHERE IT CAME FROM, or null for the first leg — a consignment arriving
    // from outside the house has no prior place this system knows, and writing
    // the consignor's address here would be inventing a fact from a form field
    // nobody filled in. The chain paints that leg as an arrival.
    fromPlace: text("from_place"),
    // A CRATE IS A PLACE, which is why forty lots move as one gesture and why
    // there is no crate table and no membership set. Packing is forty rows with
    // `to_place = 'Crate HK-114'`; the crate's contents are then the lots whose
    // LAST movement points at it, and shipping the crate is forty more rows out
    // of it. Both readings are derived, so a lot taken out of a crate by hand
    // cannot leave a stale row saying it is still inside one.
    toPlace: text("to_place").notNull(),
    // Who has it. A NAME AS TYPED, not a user reference: the custodian is
    // frequently not a user of this system — a shipper, a restorer, a
    // consignor's driver — and a foreign key to `users` would force a row for
    // every one of them. `decided_by` below is the separate question of who
    // told the system.
    custodian: text("custodian"),
    // Why it moved: "On receipt from consignor", "Pre-sale viewing". FREE
    // PROSE, not an enum, for the reason `lots.fields` is jsonb — the occasions
    // are the house's and differ between an auction house, a gallery and a
    // museum. The palette offers the common ones as suggestions; none of them
    // is a value this column knows about.
    reason: text("reason"),
    note: text("note"),
    // ── THE ONE PLACE THE PRINT PATH READS THIS TABLE ───────────────────────
    //
    // A movement marked public becomes a PROVENANCE line — "Lin family
    // collection, Taipei, acquired 1998" — and the rest stay internal custody.
    // One chain, two audiences, so the facts are typed once. The predecessor's
    // competitor keeps these in two tabs and makes a registrar type them twice,
    // which is how the catalogue and the custody record come to disagree.
    isPublic: boolean("is_public").default(false).notNull(),
    // Who said so. Same column, same meaning and same reason as on `overrides`:
    // null is a machine's unconfirmed proposal, and a human's answer before
    // sign-in exists is the org's gate identity (src/lib/data/actor.ts).
    // Nothing proposes a movement yet; the column is here so that the day
    // something does — a shipping integration reading a scan — its rows are
    // distinguishable from a registrar's without a migration.
    decidedBy: uuid("decided_by").references(() => users.id, {
      onDelete: "set null",
    }),
  },
  (t) => [
    index("movements_org").on(t.orgId),
    // The chain, newest last, in the TOTAL order the reader uses. Two
    // movements can share an instant — a correction written in the same second
    // as the leg it corrects, forty lots packed in one gesture — so the index
    // carries the tiebreaks as well, and nothing has to sort in JS to be sure.
    index("movements_lot").on(t.lotId, t.occurredAt, t.createdAt, t.id),
    // "What is in Crate HK-114" and "what is at the saleroom" are the same
    // query, and it is scoped to the org because a place name is a string two
    // houses may both use.
    index("movements_place").on(t.orgId, t.toPlace),
  ],
);

// ── Condition: what it looked like, on a named occasion ─────────────────────

export const examinations = pgTable(
  "examinations",
  {
    ...rowBase,
    orgId: uuid("org_id")
      .references(() => orgs.id, { onDelete: "cascade" })
      .notNull(),
    lotId: uuid("lot_id")
      .references(() => lots.id, { onDelete: "cascade" })
      .notNull(),
    // ── THE NULLABLE REFERENCE IS WHAT MAKES THIS ONE TABLE ─────────────────
    //
    // An examination attached to a movement is the document that travels with
    // the crate: the handoff record, "as received" or "as dispatched", and it
    // is the one a claim is argued from. An examination attached to nothing is
    // a standing check — a routine look in the store, a conservator's visit —
    // and it belongs to the lot's lifetime rather than to a handoff.
    //
    // Two tables would make the LIFETIME view, which is the whole point of
    // keeping these (the same mark seen at receipt and at dispatch), a union of
    // two shapes that every reader has to merge. One table with a nullable
    // reference makes it an ordering. `set null` rather than `cascade`: deleting
    // a movement must not delete the examination, because the observation
    // happened whatever the chain now says about the leg.
    movementId: uuid("movement_id").references(() => movements.id, {
      onDelete: "set null",
    }),
    // Who looked. A NAME AS TYPED, for the reason `movements.custodian` is.
    examiner: text("examiner"),
    // Under what light — "Daylight · raking · UV". Free prose and not a set of
    // flags: a house that checks under a Wood's lamp and one that checks in
    // north light are describing their own practice, and a fixed set would make
    // the third house's answer unsayable.
    light: text("light"),
    // The overall reading, in the examiner's own words. What prints at the head
    // of the report above the numbered marks.
    summary: text("summary"),
    decidedBy: uuid("decided_by").references(() => users.id, {
      onDelete: "set null",
    }),
  },
  (t) => [
    index("examinations_org").on(t.orgId),
    index("examinations_lot").on(t.lotId, t.createdAt, t.id),
    // NOT UNIQUE ON `movement_id`, deliberately. One handoff genuinely can
    // carry two examinations — a registrar's and a conservator's on the same
    // arrival — and a unique index would make the second person's report
    // impossible to file rather than merely unusual. What it would have bought,
    // protection from a double submit, is bought where double submits happen.
    index("examinations_movement").on(t.movementId),
  ],
);

export const marks = pgTable(
  "marks",
  {
    ...rowBase,
    orgId: uuid("org_id")
      .references(() => orgs.id, { onDelete: "cascade" })
      .notNull(),
    examinationId: uuid("examination_id")
      .references(() => examinations.id, { onDelete: "cascade" })
      .notNull(),
    // WHICH FACE OF THE OBJECT, and therefore WHICH COORDINATE SPACE. Front,
    // reverse and base are three spaces, not three layers of one: a footrim
    // mark cannot be expressed in the front view's coordinates at all. The
    // value is a slug the application validates (src/lib/data/examinations.ts,
    // REFERENCE_VIEWS) rather than a pgEnum, because a house photographing a
    // scroll wants "recto" and "verso" and an enum is a migration.
    view: text("view").notNull(),
    // ── FRACTIONS OF THE REFERENCE VIEW. NEVER OF A FILE, NEVER OF A PAGE ───
    //
    // The same discipline as `OverrideFrame`, and for a sharper reason. A
    // photograph is re-taken — a better light, a bigger sensor, a different
    // studio — and the fault is in the same place on the OBJECT. Store pixels,
    // or fractions of the image file, and every mark on the lot moves the day
    // the reference shot is replaced; a condition record whose marks move is
    // worse than no record, because a claim is argued from it.
    //
    // So the coordinate space is the VIEW — a named box of fixed proportion
    // that a photograph illustrates — and the photograph is drawn inside it.
    // The mockup's own first draft measured against the whole canvas and put
    // mark 1 in the air above the rim; that is what this comment is here to
    // stop recurring.
    //
    // KNOWN LIMIT, named rather than hidden: this survives a re-shoot at a
    // different RESOLUTION, which is the case that happens. It does not survive
    // a re-shoot at a different CROP, and nothing stored per mark could — the
    // fix for that is a measured subject box on the asset, which is where the
    // engine already keeps that kind of geometry.
    x: doublePrecision("x").notNull(),
    y: doublePrecision("y").notNull(),
    // ── FREE PROSE, AND NO TAXONOMY. That was decided ───────────────────────
    //
    // "A 4 mm surface scuff not present on receipt" is what a registrar writes
    // and what a bidder needs. A controlled vocabulary — chip / crack /
    // restoration / loss — reads tidier, is what every competitor ships, and is
    // wrong here twice: the categories differ by material (a ceramic's firing
    // flaw is not a painting's craquelure), and the interesting half of every
    // note is the qualifier the taxonomy throws away. A house that wants to
    // count its chips can search the prose; a house whose word is missing from
    // an enum cannot say what it saw.
    //
    // NO `position` COLUMN EITHER. A mark's NUMBER is its place in the order
    // its view was marked up, derived on read (principle 1: keys are never
    // positional). Storing 3 would make deleting mark 2 a renumbering job, and
    // would make the number a thing two readers could disagree about.
    note: text("note").default("").notNull(),
  },
  (t) => [
    index("marks_org").on(t.orgId),
    // Per examination, per view, in the order they were made — which is the
    // order they are numbered in, so the index and the numbering are one fact.
    index("marks_examination").on(t.examinationId, t.view, t.createdAt, t.id),
  ],
);

export const examinationAssets = pgTable(
  "examination_assets",
  {
    ...rowBase,
    orgId: uuid("org_id")
      .references(() => orgs.id, { onDelete: "cascade" })
      .notNull(),
    examinationId: uuid("examination_id")
      .references(() => examinations.id, { onDelete: "cascade" })
      .notNull(),
    assetId: uuid("asset_id")
      .references(() => assets.id, { onDelete: "cascade" })
      .notNull(),
    // WHICH VIEW THIS PHOTOGRAPH IS. The reference view is a coordinate space
    // and this is the picture that illustrates it, so a marked-up front and a
    // marked-up base are two rows here and the marks above never have to name
    // an asset.
    view: text("view").notNull(),
    // ── WHAT THIS TABLE DOES NOT CARRY, AND WHEN IT WILL ────────────────────
    //
    // No `mark_id`. A detail shot OF one mark — the mockup's ▨ and + beside
    // each note — is a real thing a registrar wants and is not shipped, so the
    // column that would hold it is not here either. That is the same rule the
    // header of this file states about tables: it arrives with its writer.
    // Adding it is one nullable column and no reshaping, because a reference
    // view and a detail shot are both "an asset this examination uses".
  },
  (t) => [
    index("examination_assets_org").on(t.orgId),
    // ONE PHOTOGRAPH PER VIEW PER EXAMINATION. Two would make "which picture
    // are these fractions of" a question with two answers, and the marks would
    // be drawn over whichever one a query happened to return first.
    uniqueIndex("examination_assets_view").on(t.examinationId, t.view),
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
  movements: many(movements),
  examinations: many(examinations),
}));

export const movementsRelations = relations(movements, ({ one, many }) => ({
  lot: one(lots, { fields: [movements.lotId], references: [lots.id] }),
  // The examinations filed AGAINST this handoff. Zero, usually; the chain
  // paints a leg with none as "no report", which is a fact a registrar acts on.
  examinations: many(examinations),
}));

export const examinationsRelations = relations(examinations, ({ one, many }) => ({
  lot: one(lots, { fields: [examinations.lotId], references: [lots.id] }),
  movement: one(movements, {
    fields: [examinations.movementId],
    references: [movements.id],
  }),
  marks: many(marks),
  assets: many(examinationAssets),
}));

export const marksRelations = relations(marks, ({ one }) => ({
  examination: one(examinations, {
    fields: [marks.examinationId],
    references: [examinations.id],
  }),
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
