DROP INDEX "workload_s3_bucket_name_unique";--> statement-breakpoint
ALTER TABLE "workload" ADD COLUMN "bucket_name" varchar(63);--> statement-breakpoint
ALTER TABLE "workload" ADD CONSTRAINT "workload_bucket_name_unique" UNIQUE("bucket_name");