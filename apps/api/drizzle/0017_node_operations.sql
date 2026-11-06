CREATE TYPE "public"."node_operation_status" AS ENUM('running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."node_operation_type" AS ENUM('add', 'drain', 'remove');--> statement-breakpoint
CREATE TABLE "node_operation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"node_name" varchar(253) NOT NULL,
	"type" "node_operation_type" NOT NULL,
	"status" "node_operation_status" DEFAULT 'running' NOT NULL,
	"step" varchar(32),
	"message" text,
	"evicted" integer DEFAULT 0 NOT NULL,
	"remaining" integer DEFAULT 0 NOT NULL,
	"stuck" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"log" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"actor" varchar(255),
	"started_at" timestamp DEFAULT now() NOT NULL,
	"finished_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "node_operation_node_name_idx" ON "node_operation" USING btree ("node_name","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "node_operation_running_unique" ON "node_operation" USING btree ("node_name") WHERE "node_operation"."status" = 'running';