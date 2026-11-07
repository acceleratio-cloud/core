ALTER TABLE "workload_version" ADD COLUMN "created_by_id" text;--> statement-breakpoint
ALTER TABLE "workload_version" ADD COLUMN "created_by_name" text;--> statement-breakpoint
ALTER TABLE "workload_version" ADD COLUMN "created_by_email" text;--> statement-breakpoint
ALTER TABLE "workload_version" ADD CONSTRAINT "workload_version_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;