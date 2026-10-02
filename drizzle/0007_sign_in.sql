-- Sign-in: Google names the person, a row in the database keeps them signed in.
--
-- ── WHAT THIS REPLACES ─────────────────────────────────────────────────────
--
-- One shared HTTP basic password in front of the whole deployed instance
-- (src/proxy.ts), which could not be revoked for one person, could not say who
-- did anything, and meant `overrides.decided_by` named a gate identity rather
-- than a human. The gate stays in the code for local development, where
-- GATE_PASSWORD is empty and nothing is gated at all.
--
-- ── NO PASSWORD COLUMN, AND THERE WILL NOT BE ONE ──────────────────────────
--
-- Google is the only way in, so this product never stores, hashes, resets or
-- leaks a password. `users.google_sub` is the identity; the email is what a
-- person is INVITED by, and the two are bound together at first sign-in. An
-- address can be renamed and later reissued to somebody else — binding the
-- session to the address would eventually hand a stranger somebody's house.
--
-- ── NULLABLE, AND EVERY EXISTING ROW STAYS VALID ───────────────────────────
--
-- `google_sub` is null for the gate identities this database already holds and
-- for anybody invited who has not signed in yet. Nothing is backfilled: a gate
-- identity is honestly "a member of the house, before the system could say
-- which one" (src/lib/data/actor.ts) and inventing a Google account for it
-- would be a fact nobody witnessed, in a column a session is bound to.
--
-- `sessions` carries no `org_id`, alone among the tables that are not `orgs`
-- or `users`. A session belongs to a PERSON; which house they are looking at
-- is a property of the request and of their memberships, not of being signed
-- in. See src/db/schema.ts.

CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "google_sub" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sessions_user" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_google_sub_unique" UNIQUE("google_sub");