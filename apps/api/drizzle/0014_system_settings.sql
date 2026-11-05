CREATE TYPE "public"."control_plane_change_status" AS ENUM('awaiting_dns', 'provisioning', 'failed');--> statement-breakpoint
CREATE TABLE "system_setting" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"control_plane_url" text,
	"pending_control_plane_url" text,
	"pending_status" "control_plane_change_status",
	"pending_error" text,
	"pending_applied_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "system_setting_singleton" CHECK ("system_setting"."id" = 1)
);
