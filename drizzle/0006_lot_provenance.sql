ALTER TABLE "lots" ADD COLUMN "import_run_id" uuid;--> statement-breakpoint
ALTER TABLE "lots" ADD COLUMN "source_row" integer;--> statement-breakpoint
ALTER TABLE "lots" ADD CONSTRAINT "lots_import_run_id_import_runs_id_fk" FOREIGN KEY ("import_run_id") REFERENCES "public"."import_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lots_import_run" ON "lots" USING btree ("import_run_id");