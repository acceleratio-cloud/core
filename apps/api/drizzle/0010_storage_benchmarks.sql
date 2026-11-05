CREATE TYPE "public"."storage_benchmark_status" AS ENUM('pending', 'running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TABLE "storage_benchmark" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"storage_class_id" uuid NOT NULL,
	"status" "storage_benchmark_status" DEFAULT 'pending' NOT NULL,
	"status_message" text,
	"results" jsonb,
	"external_name" varchar(63) NOT NULL,
	"started_at" timestamp,
	"finished_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "storage_benchmark" ADD CONSTRAINT "storage_benchmark_storage_class_id_storage_class_id_fk" FOREIGN KEY ("storage_class_id") REFERENCES "public"."storage_class"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "storage_benchmark_storage_class_id_idx" ON "storage_benchmark" USING btree ("storage_class_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "storage_benchmark_active_unique" ON "storage_benchmark" USING btree ((true)) WHERE "storage_benchmark"."status" in ('pending', 'running');