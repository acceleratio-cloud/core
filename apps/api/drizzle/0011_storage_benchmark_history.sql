ALTER TABLE "storage_benchmark" DROP CONSTRAINT "storage_benchmark_storage_class_id_storage_class_id_fk";
--> statement-breakpoint
ALTER TABLE "storage_benchmark" ALTER COLUMN "storage_class_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "storage_benchmark" ADD COLUMN IF NOT EXISTS "storage_class_name" varchar(255);--> statement-breakpoint
UPDATE "storage_benchmark" SET "storage_class_name" = "storage_class"."name" FROM "storage_class" WHERE "storage_class"."id" = "storage_benchmark"."storage_class_id" AND "storage_benchmark"."storage_class_name" IS NULL;--> statement-breakpoint
UPDATE "storage_benchmark" SET "storage_class_name" = 'Deleted profile' WHERE "storage_class_name" IS NULL;--> statement-breakpoint
ALTER TABLE "storage_benchmark" ALTER COLUMN "storage_class_name" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "storage_benchmark" ADD CONSTRAINT "storage_benchmark_storage_class_id_storage_class_id_fk" FOREIGN KEY ("storage_class_id") REFERENCES "public"."storage_class"("id") ON DELETE set null ON UPDATE no action;