ALTER TABLE "storage_benchmark" ADD COLUMN "tests" jsonb;--> statement-breakpoint
ALTER TABLE "storage_benchmark" ADD COLUMN "current_test" varchar(32);--> statement-breakpoint
ALTER TABLE "storage_benchmark" ADD COLUMN "failed_step" varchar(32);--> statement-breakpoint
ALTER TABLE "storage_benchmark" ADD COLUMN "profile_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "storage_benchmark" ADD COLUMN "environment" jsonb;