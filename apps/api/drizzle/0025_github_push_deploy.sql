ALTER TYPE "public"."workload_build_status" ADD VALUE 'cancelled';--> statement-breakpoint
ALTER TABLE "workload" ADD COLUMN "auto_deploy" boolean DEFAULT true NOT NULL;