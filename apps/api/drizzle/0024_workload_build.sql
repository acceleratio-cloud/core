CREATE TYPE "public"."workload_build_status" AS ENUM('building', 'succeeded', 'failed');--> statement-breakpoint
CREATE TABLE "workload_build" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workload_id" uuid NOT NULL,
	"commit_sha" varchar(64) NOT NULL,
	"commit_message" text,
	"status" "workload_build_status" DEFAULT 'building' NOT NULL,
	"status_message" text,
	"image" text,
	"external_name" varchar(63) NOT NULL,
	"author" jsonb,
	"log" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"finished_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "workload_build" ADD CONSTRAINT "workload_build_workload_id_workload_id_fk" FOREIGN KEY ("workload_id") REFERENCES "public"."workload"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workload_build_workload_id_created_at_idx" ON "workload_build" USING btree ("workload_id","created_at");