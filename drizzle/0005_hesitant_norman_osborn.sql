ALTER TABLE "requirements" DROP CONSTRAINT "requirements_key_unique";--> statement-breakpoint
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_key_unique";--> statement-breakpoint
ALTER TABLE "events" ALTER COLUMN "project_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "ideas" ALTER COLUMN "project_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "narratives" ALTER COLUMN "project_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "requirements" ALTER COLUMN "project_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ALTER COLUMN "project_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "requirements" ADD CONSTRAINT "requirements_project_key_unique" UNIQUE("project_id","key");--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_key_unique" UNIQUE("project_id","key");