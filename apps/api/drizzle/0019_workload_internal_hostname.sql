ALTER TABLE "workload" ADD COLUMN "internal_hostname" varchar(63);--> statement-breakpoint
ALTER TABLE "workload" ADD CONSTRAINT "workload_project_id_internal_hostname_unique" UNIQUE("project_id","internal_hostname");
