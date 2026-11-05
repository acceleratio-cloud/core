CREATE TABLE "workload_version" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workload_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"config" jsonb NOT NULL,
	"source_version_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "workload_version_workload_id_number_unique" UNIQUE("workload_id","number")
);
--> statement-breakpoint
ALTER TABLE "workload" ADD COLUMN "active_version_id" uuid;--> statement-breakpoint
ALTER TABLE "workload" ADD COLUMN "draft_config" jsonb;--> statement-breakpoint
ALTER TABLE "workload_version" ADD CONSTRAINT "workload_version_workload_id_workload_id_fk" FOREIGN KEY ("workload_id") REFERENCES "public"."workload"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workload_version" ADD CONSTRAINT "workload_version_source_version_id_workload_version_id_fk" FOREIGN KEY ("source_version_id") REFERENCES "public"."workload_version"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workload_version_workload_id_idx" ON "workload_version" USING btree ("workload_id");--> statement-breakpoint
ALTER TABLE "workload" ADD CONSTRAINT "workload_active_version_id_workload_version_id_fk" FOREIGN KEY ("active_version_id") REFERENCES "public"."workload_version"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Backfill. A workload that was deployed before versions existed gets v1 with
-- its current config, applied at its last deploy; one that never deployed
-- keeps that config as its draft. A legacy `port` key is dropped on the way.
-- Every statement skips rows it already filled, so a rerun is a no-op.
INSERT INTO "workload_version" ("workload_id", "number", "config", "created_at")
SELECT "id", 1, "config" - 'port', "last_deployed_at"
FROM "workload"
WHERE "last_deployed_at" IS NOT NULL
ON CONFLICT ("workload_id", "number") DO NOTHING;--> statement-breakpoint
UPDATE "workload" AS target
SET "active_version_id" = version."id"
FROM "workload_version" AS version
WHERE version."workload_id" = target."id"
  AND version."number" = 1
  AND target."active_version_id" IS NULL;--> statement-breakpoint
UPDATE "workload"
SET "draft_config" = "config" - 'port'
WHERE "last_deployed_at" IS NULL AND "draft_config" IS NULL;
