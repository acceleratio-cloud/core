CREATE TYPE "public"."image_scan_status" AS ENUM('pending', 'scanning', 'succeeded', 'failed');--> statement-breakpoint
CREATE TABLE "image_scan" (
	"id" uuid PRIMARY KEY NOT NULL,
	"digest" varchar(80) NOT NULL,
	"image" text NOT NULL,
	"status" "image_scan_status" DEFAULT 'pending' NOT NULL,
	"status_message" text,
	"counts" jsonb,
	"fixable" integer,
	"vulnerabilities" jsonb,
	"external_name" varchar(63),
	"requested_at" timestamp DEFAULT now() NOT NULL,
	"started_at" timestamp,
	"finished_at" timestamp,
	"last_seen_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "image_scan_digest_unique" ON "image_scan" USING btree ("digest");--> statement-breakpoint
CREATE INDEX "image_scan_status_idx" ON "image_scan" USING btree ("status","requested_at");--> statement-breakpoint
CREATE UNIQUE INDEX "image_scan_active_unique" ON "image_scan" USING btree ((true)) WHERE "image_scan"."status" = 'scanning';