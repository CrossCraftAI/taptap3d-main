-- The review layer: somebody's remark about one part of one catalogue.
--
-- A house reviewing a proof had nowhere to put this, so the conversation
-- happened in email — which is the thing this product exists to replace.
--
-- KEYED (lot, field), the same as `overrides` and for the same reason
-- (ARCHITECTURE.md principle 1): a comment pinned to a point on page five is
-- about nothing the moment somebody changes the density, because the same lot
-- is p5-s1 at 4-up and p2-s3 at 9-up.
--
-- `field` nullable, because a remark about the whole lot is a different remark
-- from one about its maker. `parent_id` self-referencing, because a reply is a
-- comment with a parent and a second table would repeat every column here.
-- `author_id` NOT NULL, unlike `overrides.decided_by`: nothing proposes a
-- comment, and a remark with no author is a rumour.
--
-- Resolving is RECORDED rather than deleting: "we discussed this and decided
-- no" is the answer to the person who asks again next week.

CREATE TABLE "lot_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"org_id" uuid NOT NULL,
	"catalogue_id" uuid NOT NULL,
	"lot_id" uuid NOT NULL,
	"field" text,
	"parent_id" uuid,
	"body" text NOT NULL,
	"author_id" uuid NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" uuid
);
--> statement-breakpoint
ALTER TABLE "lot_comments" ADD CONSTRAINT "lot_comments_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lot_comments" ADD CONSTRAINT "lot_comments_catalogue_id_catalogues_id_fk" FOREIGN KEY ("catalogue_id") REFERENCES "public"."catalogues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lot_comments" ADD CONSTRAINT "lot_comments_lot_id_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."lots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lot_comments" ADD CONSTRAINT "lot_comments_parent_id_lot_comments_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."lot_comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lot_comments" ADD CONSTRAINT "lot_comments_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lot_comments" ADD CONSTRAINT "lot_comments_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lot_comments_org" ON "lot_comments" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "lot_comments_catalogue" ON "lot_comments" USING btree ("catalogue_id");--> statement-breakpoint
CREATE INDEX "lot_comments_lot" ON "lot_comments" USING btree ("lot_id");--> statement-breakpoint
CREATE INDEX "lot_comments_parent" ON "lot_comments" USING btree ("parent_id");