CREATE TYPE "public"."workload_domain_certificate_status" AS ENUM('pending', 'issued', 'failed');--> statement-breakpoint
ALTER TABLE "workload_domain" ADD COLUMN "certificate_status" "workload_domain_certificate_status" DEFAULT 'pending' NOT NULL;--> statement-breakpoint
-- Custom domains already in `success` served a trusted certificate. Routed
-- generated domains started issuing when they were created.
UPDATE "workload_domain" SET "certificate_status" = 'issued' WHERE "status" = 'success';--> statement-breakpoint
UPDATE "workload_domain" SET "verified_at" = "created_at" WHERE "kind" = 'generated' AND "verified_at" IS NULL;
