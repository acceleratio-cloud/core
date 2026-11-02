CREATE TYPE "public"."workload_status" AS ENUM('draft', 'deploying', 'running', 'stopped', 'failed');--> statement-breakpoint
ALTER TABLE "workload" ADD COLUMN "external_name" varchar(63);--> statement-breakpoint
ALTER TABLE "workload" ADD COLUMN "status" "workload_status" DEFAULT 'draft' NOT NULL;--> statement-breakpoint
ALTER TABLE "workload" ADD COLUMN "status_message" text;--> statement-breakpoint
ALTER TABLE "workload" ADD COLUMN "last_deployed_at" timestamp;--> statement-breakpoint
UPDATE "workload" SET "external_name" = 'w-' || replace("id"::text, '-', '') WHERE "external_name" IS NULL;--> statement-breakpoint
ALTER TABLE "workload" ALTER COLUMN "external_name" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "workload" ADD CONSTRAINT "workload_project_id_external_name_unique" UNIQUE("project_id","external_name");
