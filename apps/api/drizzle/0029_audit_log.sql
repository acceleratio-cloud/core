CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"project_id" uuid,
	"action" varchar(100) NOT NULL,
	"outcome" varchar(16) NOT NULL,
	"status_code" integer,
	"error" text,
	"actor_type" varchar(16) NOT NULL,
	"actor_id" text,
	"actor_name" text,
	"actor_email" text,
	"session_id" text,
	"ip_address" text,
	"user_agent" text,
	"workload_id" uuid,
	"workload_name" text,
	"http_method" varchar(10),
	"http_path" text,
	"duration_ms" integer,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE INDEX "audit_log_project_created_idx" ON "audit_log" USING btree ("project_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_log_created_idx" ON "audit_log" USING btree ("created_at");