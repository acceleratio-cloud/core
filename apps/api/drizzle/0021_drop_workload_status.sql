ALTER TABLE "workload" DROP COLUMN "status";--> statement-breakpoint
ALTER TABLE "workload" DROP COLUMN "status_message";--> statement-breakpoint
ALTER TABLE "workload" DROP COLUMN "status_observed_at";--> statement-breakpoint
DROP TYPE "public"."workload_status";