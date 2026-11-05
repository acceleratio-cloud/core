CREATE TYPE "public"."workload_domain_kind" AS ENUM('generated', 'custom');--> statement-breakpoint
CREATE TYPE "public"."workload_domain_status" AS ENUM('generated', 'verification', 'success', 'failed');--> statement-breakpoint
CREATE TABLE "workload_domain" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workload_id" uuid NOT NULL,
	"hostname" varchar(253) NOT NULL,
	"kind" "workload_domain_kind" NOT NULL,
	"port" integer NOT NULL,
	"status" "workload_domain_status" NOT NULL,
	"status_message" text,
	"routed" boolean DEFAULT false NOT NULL,
	"verified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "workload_domain_hostname_unique" UNIQUE("hostname"),
	CONSTRAINT "workload_domain_port_range" CHECK ("workload_domain"."port" between 1 and 65535)
);
--> statement-breakpoint
ALTER TABLE "workload_domain" ADD CONSTRAINT "workload_domain_workload_id_workload_id_fk" FOREIGN KEY ("workload_id") REFERENCES "public"."workload"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workload_domain_workload_id_idx" ON "workload_domain" USING btree ("workload_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workload_domain_generated_unique" ON "workload_domain" USING btree ("workload_id") WHERE "workload_domain"."kind" = 'generated';