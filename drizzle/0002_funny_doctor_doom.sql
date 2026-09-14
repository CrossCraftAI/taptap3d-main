ALTER TABLE "catalogues" ADD COLUMN "exported_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "stage_override" text;