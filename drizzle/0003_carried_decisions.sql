-- Give the predecessor's carried decisions a decider.
--
-- docker/migrate-from-tap3d.mjs wrote every row it carried with
-- `decided_by = null`, the predecessor's hidden-field decisions among them.
-- Null in this column means one thing — a machine proposed it and nobody has
-- confirmed (src/db/schema.ts) — and listOverrides filters on exactly that
-- (src/lib/data/overrides.ts). So those rows are not merely mislabelled: they
-- are invisible to the engine, and every catalogue prints the field a
-- specialist decided to suppress. src/lib/data/actor.ts names the count it saw:
-- thirteen.
--
-- ── WHICH ROWS: THE VALUE DECIDES IT, NOT THE FIELD KEY ─────────────────────
--
-- The same run also carried the predecessor's PROPOSALS into this table, under
-- a composite field key (`title:crop`) and with `{proposal: true, …}` in the
-- value. Those must stay null. A proposal is not an edit, and a migration that
-- confirmed one would be inventing a human decision — the one thing in this
-- table nobody can audit afterwards.
--
-- The line is drawn on the `proposal` KEY IN THE VALUE, because that is where
-- overrideFromValue draws it: it refuses on the key's presence, whatever the
-- key holds. Drawing it the same way here means the migration and the reader
-- cannot come to disagree about what a proposal is.
--
-- Rejected: matching the field key for a colon. That is how today's proposals
-- happen to be named, not a promise about them, and the day a real field
-- carries a colon its decisions would be skipped here in silence.
-- Rejected: `value->>'proposal' = 'true'`. The reader refuses on presence, so
-- `{"proposal": false}` would be confirmed here and still refused there — a row
-- that is decided and invisible, which is worse than either state alone.
-- Rejected: a cutoff on `created_at`. It would make this inert against a row
-- written after today — but so does the migration runner, which applies a file
-- once per database and never again, so the cutoff buys nothing it appears to
-- buy and only adds a date to read wrongly later. (An earlier draft of this
-- note claimed the cutoff would strand rows in a house carried across after
-- today. Dropping it strands them too, for the same reason: there is no second
-- run. That is a defect in the SOURCE, and it is fixed there —
-- docker/migrate-from-tap3d.mjs now resolves the same gate identity and writes
-- it at insert time. This file is the rescue for the rows already carried.)
--
-- `jsonb_exists(value, 'proposal')` rather than `value ? 'proposal'`: the same
-- operator, spelled so that nothing between this file and Postgres can mistake
-- it for a bind placeholder.
--
-- ── WHO, GIVEN THAT THIS RUNS BEFORE THERE IS EVER A REQUEST ────────────────
--
-- `decided_by` is a foreign key, so the answer has to be a real `users` row,
-- and the only honest one is the GATE IDENTITY: `gate@<slug>.taptap3d.invalid`,
-- the row src/lib/data/actor.ts makes on first use. It says what is true of
-- these thirteen — a member of the house decided, before the system could name
-- which one.
--
-- It is created HERE rather than waited for, because a migration runs before
-- any request and there may never be a request that touches these catalogues at
-- all. The ADDRESS is the key, so the identity written here and the identity
-- `currentActorId()` later finds are one row and not two. That address is
-- duplicated out of TypeScript into SQL and duplication drifts, which is why
-- test/carried-decisions.db.test.ts runs this file and then asks
-- `currentActorId()` whether it agrees.
--
-- THE MEMBERSHIP IS NOT OPTIONAL. `currentActorId` returns early when the user
-- already exists and never reaches its membership insert, so a gate identity
-- this migration creates without one would never acquire one afterwards.
--
-- Only orgs that actually hold a carried decision get an identity. A migration
-- that made a person for every tenant in order to name none of them would leave
-- rows nobody could account for.
--
-- Idempotent throughout: both inserts conflict to nothing, and the update's own
-- predicate stops matching the moment it has run.
INSERT INTO "users" ("email", "name")
SELECT
	'gate@' || "orgs"."slug" || '.taptap3d.invalid',
	"orgs"."name" || ' — via the gate'
FROM "orgs"
WHERE EXISTS (
	SELECT 1 FROM "overrides"
	WHERE "overrides"."org_id" = "orgs"."id"
		AND "overrides"."decided_by" IS NULL
		AND NOT jsonb_exists("overrides"."value", 'proposal')
)
ON CONFLICT ("email") DO NOTHING;
--> statement-breakpoint
INSERT INTO "memberships" ("org_id", "user_id", "role")
SELECT "orgs"."id", "users"."id", 'member'::"public"."member_role"
FROM "orgs"
JOIN "users" ON "users"."email" = 'gate@' || "orgs"."slug" || '.taptap3d.invalid'
WHERE EXISTS (
	SELECT 1 FROM "overrides"
	WHERE "overrides"."org_id" = "orgs"."id"
		AND "overrides"."decided_by" IS NULL
		AND NOT jsonb_exists("overrides"."value", 'proposal')
)
ON CONFLICT ("org_id", "user_id") DO NOTHING;
--> statement-breakpoint
-- `updated_at` IS LEFT ALONE, deliberately. Nothing about the row's content
-- changes here; what changes is the record of who had already decided it. A
-- touch would have every carried decision claim it was edited on the day of the
-- deployment, which is the one fact about them that is not true.
UPDATE "overrides"
SET "decided_by" = "users"."id"
FROM "orgs", "users"
WHERE "overrides"."org_id" = "orgs"."id"
	AND "users"."email" = 'gate@' || "orgs"."slug" || '.taptap3d.invalid'
	AND "overrides"."decided_by" IS NULL
	AND NOT jsonb_exists("overrides"."value", 'proposal');
