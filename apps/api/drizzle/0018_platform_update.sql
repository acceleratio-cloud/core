CREATE TYPE "public"."platform_update_status" AS ENUM('pending', 'running', 'succeeded', 'failed', 'rolled_back');--> statement-breakpoint
CREATE TABLE "platform_release_check" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"latest_version" varchar(64),
	"releases" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"checked_at" timestamp,
	"error" text,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "platform_release_check_singleton" CHECK ("platform_release_check"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "platform_update" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_version" varchar(64) NOT NULL,
	"to_version" varchar(64) NOT NULL,
	"status" "platform_update_status" DEFAULT 'pending' NOT NULL,
	"stage" varchar(32),
	"message" text,
	"log" text DEFAULT '' NOT NULL,
	"external_name" varchar(63) NOT NULL,
	"actor" varchar(255),
	"started_at" timestamp DEFAULT now() NOT NULL,
	"reported_at" timestamp,
	"finished_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "platform_update_started_at_idx" ON "platform_update" USING btree ("started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_update_active_unique" ON "platform_update" USING btree ((true)) WHERE "platform_update"."status" in ('pending', 'running');