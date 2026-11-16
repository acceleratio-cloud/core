CREATE TYPE "public"."member_role" AS ENUM('owner', 'admin', 'viewer', 'custom');--> statement-breakpoint
CREATE TYPE "public"."project_access" AS ENUM('read', 'edit', 'delete');--> statement-breakpoint
CREATE TABLE "custom_role" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "custom_role_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "custom_role_project" (
	"role_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"access" "project_access" NOT NULL,
	CONSTRAINT "custom_role_project_role_id_project_id_pk" PRIMARY KEY("role_id","project_id")
);
--> statement-breakpoint
CREATE TABLE "invite" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"role" "member_role" NOT NULL,
	"role_id" uuid,
	"max_uses" integer,
	"use_count" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "invite_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "invite_role_check" CHECK ("invite"."role" <> 'owner'),
	CONSTRAINT "invite_custom_role_check" CHECK (("invite"."role" = 'custom') = ("invite"."role_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "member" (
	"user_id" text PRIMARY KEY NOT NULL,
	"role" "member_role" NOT NULL,
	"role_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "member_custom_role_check" CHECK (("member"."role" = 'custom') = ("member"."role_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "custom_role_project" ADD CONSTRAINT "custom_role_project_role_id_custom_role_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."custom_role"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_role_project" ADD CONSTRAINT "custom_role_project_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invite" ADD CONSTRAINT "invite_role_id_custom_role_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."custom_role"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invite" ADD CONSTRAINT "invite_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_role_id_custom_role_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."custom_role"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "custom_role_project_project_id_idx" ON "custom_role_project" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "member_owner_unique" ON "member" USING btree ("role") WHERE "member"."role" = 'owner';--> statement-breakpoint
CREATE INDEX "member_role_id_idx" ON "member" USING btree ("role_id");--> statement-breakpoint
-- Every existing account keeps its access: the earliest becomes the owner.
INSERT INTO "member" ("user_id", "role")
SELECT "id", (CASE WHEN row_number() OVER (ORDER BY "created_at", "id") = 1 THEN 'owner' ELSE 'admin' END)::"member_role"
FROM "user"
ON CONFLICT DO NOTHING;
