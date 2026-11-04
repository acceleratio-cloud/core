ALTER TYPE "public"."workload_type" ADD VALUE 's3_bucket';--> statement-breakpoint
ALTER TABLE "workload" ADD COLUMN "storage_class_id" uuid;--> statement-breakpoint
ALTER TABLE "workload" ADD CONSTRAINT "workload_storage_class_id_storage_class_id_fk" FOREIGN KEY ("storage_class_id") REFERENCES "public"."storage_class"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workload_s3_bucket_name_unique" ON "workload" USING btree ("external_name") WHERE "workload"."storage_class_id" is not null;