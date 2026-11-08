CREATE TABLE "github_app" (
	"id" uuid PRIMARY KEY NOT NULL,
	"github_app_id" bigint NOT NULL,
	"name" varchar(255) NOT NULL,
	"slug" varchar(255) NOT NULL,
	"owner_login" varchar(255) NOT NULL,
	"html_url" text NOT NULL,
	"client_id" varchar(255) NOT NULL,
	"client_secret_enc" text NOT NULL,
	"webhook_secret_enc" text NOT NULL,
	"private_key_enc" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "github_app_github_app_id_unique" UNIQUE("github_app_id")
);
--> statement-breakpoint
CREATE TABLE "github_installation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"app_id" uuid NOT NULL,
	"installation_id" bigint NOT NULL,
	"account_login" varchar(255) NOT NULL,
	"account_type" varchar(32) NOT NULL,
	"repository_selection" varchar(16) DEFAULT 'all' NOT NULL,
	"suspended" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "github_installation_installation_id_unique" UNIQUE("installation_id")
);
--> statement-breakpoint
ALTER TABLE "github_installation" ADD CONSTRAINT "github_installation_app_id_github_app_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."github_app"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "github_installation_app_id_idx" ON "github_installation" USING btree ("app_id");