CREATE TABLE "security_acceptance" (
	"recommendation_id" varchar(120) PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"workload_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"accepted_by" text,
	"fixes" jsonb,
	"exploited" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "security_recommendation_seen" (
	"recommendation_id" varchar(120) PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"workload_id" uuid NOT NULL,
	"first_seen_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "security_acceptance" ADD CONSTRAINT "security_acceptance_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_acceptance" ADD CONSTRAINT "security_acceptance_workload_id_workload_id_fk" FOREIGN KEY ("workload_id") REFERENCES "public"."workload"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_recommendation_seen" ADD CONSTRAINT "security_recommendation_seen_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_recommendation_seen" ADD CONSTRAINT "security_recommendation_seen_workload_id_workload_id_fk" FOREIGN KEY ("workload_id") REFERENCES "public"."workload"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "security_acceptance_project_id_idx" ON "security_acceptance" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "security_recommendation_seen_project_id_idx" ON "security_recommendation_seen" USING btree ("project_id");