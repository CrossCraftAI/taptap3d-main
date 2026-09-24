-- Custody and condition: the two things a registrar does that this system
-- could not record.
--
-- ── WHY FOUR TABLES AND NOT TWO COLUMNS ────────────────────────────────────
--
-- The cheap build is `lots.current_place` and `lots.condition_note`. Both are
-- one ALTER, and both are a second source of truth for facts a chain of events
-- already holds: the column says the saleroom, the chain says Kwai Chung, and
-- nothing says which lied. ARCHITECTURE.md principle 2 — nothing is stored
-- that the engine cannot re-derive — so where a lot IS is the last movement's
-- `to_place`, computed on every read, and correcting it APPENDS a row rather
-- than overwriting a field. src/db/schema.ts carries the rest of that argument
-- beside each column.
--
-- ── WHY `movements` IS THE TABLE THE OTHERS HANG OFF ───────────────────────
--
-- `examinations.movement_id` references it, so the creation order is forced.
-- It is also the honest reading order: an examination is filed ON an occasion,
-- and the occasion is a handoff. That reference is NULLABLE, and that is the
-- whole reason a per-handoff report and a lifetime history are one table
-- rather than two shapes every reader has to merge.
--
-- ── WHAT IS DELIBERATELY ABSENT ────────────────────────────────────────────
--
-- No `crates` table: a crate is a PLACE, so packing forty lots is forty rows
-- naming the crate as their `to_place`, and the crate's contents are a query
-- rather than a membership set that can go stale.
-- No `places` table: a place is a string a house types, the way `lots.ref` is,
-- and a vocabulary nobody authors inside the system yet is exactly the empty
-- table DFD.md §2 refuses.
-- No `position` on `marks`: a mark's number is its place in the order its view
-- was marked up, derived on read, because a stored number makes deleting mark
-- two a renumbering job (principle 1 — keys are never positional).
-- No `mark_id` on `examination_assets`: detail shots of one mark are not
-- shipped, and the column that would hold them arrives with them.
--
-- ── NOTHING IS BACKFILLED, AND THAT IS THE CORRECT ANSWER ──────────────────
--
-- Every existing lot comes out of this migration with no movements and no
-- examinations, which reads as "nowhere recorded" and "not examined" — both
-- true, and both shown as such. Inventing a first movement per lot ("received,
-- on the date the row was created") would put a fact into a custody chain that
-- nobody witnessed, and the chain is the thing a claim is argued from.
CREATE TABLE "examination_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"org_id" uuid NOT NULL,
	"examination_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"view" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "examinations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"org_id" uuid NOT NULL,
	"lot_id" uuid NOT NULL,
	"movement_id" uuid,
	"examiner" text,
	"light" text,
	"summary" text,
	"decided_by" uuid
);
--> statement-breakpoint
CREATE TABLE "marks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"org_id" uuid NOT NULL,
	"examination_id" uuid NOT NULL,
	"view" text NOT NULL,
	"x" double precision NOT NULL,
	"y" double precision NOT NULL,
	"note" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"org_id" uuid NOT NULL,
	"lot_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"from_place" text,
	"to_place" text NOT NULL,
	"custodian" text,
	"reason" text,
	"note" text,
	"is_public" boolean DEFAULT false NOT NULL,
	"decided_by" uuid
);
--> statement-breakpoint
ALTER TABLE "examination_assets" ADD CONSTRAINT "examination_assets_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "examination_assets" ADD CONSTRAINT "examination_assets_examination_id_examinations_id_fk" FOREIGN KEY ("examination_id") REFERENCES "public"."examinations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "examination_assets" ADD CONSTRAINT "examination_assets_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "examinations" ADD CONSTRAINT "examinations_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "examinations" ADD CONSTRAINT "examinations_lot_id_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."lots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "examinations" ADD CONSTRAINT "examinations_movement_id_movements_id_fk" FOREIGN KEY ("movement_id") REFERENCES "public"."movements"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "examinations" ADD CONSTRAINT "examinations_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marks" ADD CONSTRAINT "marks_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marks" ADD CONSTRAINT "marks_examination_id_examinations_id_fk" FOREIGN KEY ("examination_id") REFERENCES "public"."examinations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movements" ADD CONSTRAINT "movements_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movements" ADD CONSTRAINT "movements_lot_id_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."lots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movements" ADD CONSTRAINT "movements_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "examination_assets_org" ON "examination_assets" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "examination_assets_view" ON "examination_assets" USING btree ("examination_id","view");--> statement-breakpoint
CREATE INDEX "examinations_org" ON "examinations" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "examinations_lot" ON "examinations" USING btree ("lot_id","created_at","id");--> statement-breakpoint
CREATE INDEX "examinations_movement" ON "examinations" USING btree ("movement_id");--> statement-breakpoint
CREATE INDEX "marks_org" ON "marks" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "marks_examination" ON "marks" USING btree ("examination_id","view","created_at","id");--> statement-breakpoint
CREATE INDEX "movements_org" ON "movements" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "movements_lot" ON "movements" USING btree ("lot_id","occurred_at","created_at","id");--> statement-breakpoint
CREATE INDEX "movements_place" ON "movements" USING btree ("org_id","to_place");