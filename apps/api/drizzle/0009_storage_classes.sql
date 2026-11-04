CREATE TYPE "public"."storage_class_kind" AS ENUM('platform', 'custom');--> statement-breakpoint
CREATE TYPE "public"."storage_class_reclaim_policy" AS ENUM('Delete', 'Retain');--> statement-breakpoint
CREATE TYPE "public"."storage_class_volume_binding_mode" AS ENUM('Immediate', 'WaitForFirstConsumer');--> statement-breakpoint
CREATE TABLE "storage_class" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "storage_class_kind" NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"external_name" varchar(63) NOT NULL,
	"parameters" jsonb,
	"reclaim_policy" "storage_class_reclaim_policy",
	"volume_binding_mode" "storage_class_volume_binding_mode",
	"allow_volume_expansion" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "storage_class_external_name_unique" ON "storage_class" USING btree ("external_name");--> statement-breakpoint
CREATE UNIQUE INDEX "storage_class_platform_unique" ON "storage_class" USING btree ("kind") WHERE "storage_class"."kind" = 'platform';