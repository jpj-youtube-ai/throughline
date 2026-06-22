ALTER TABLE "events" ADD COLUMN "project_id" uuid;--> statement-breakpoint
ALTER TABLE "ideas" ADD COLUMN "project_id" uuid;--> statement-breakpoint
ALTER TABLE "narratives" ADD COLUMN "project_id" uuid;--> statement-breakpoint
ALTER TABLE "requirements" ADD COLUMN "project_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "project_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "active_project_id" uuid;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ideas" ADD CONSTRAINT "ideas_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "narratives" ADD CONSTRAINT "narratives_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirements" ADD CONSTRAINT "requirements_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_active_project_id_project_id_fk" FOREIGN KEY ("active_project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
UPDATE "requirements" SET "project_id" = (SELECT id FROM project ORDER BY created_at LIMIT 1) WHERE "project_id" IS NULL;--> statement-breakpoint
UPDATE "ideas" SET "project_id" = (SELECT id FROM project ORDER BY created_at LIMIT 1) WHERE "project_id" IS NULL;--> statement-breakpoint
UPDATE "tasks" SET "project_id" = (SELECT id FROM project ORDER BY created_at LIMIT 1) WHERE "project_id" IS NULL;--> statement-breakpoint
UPDATE "narratives" SET "project_id" = (SELECT id FROM project ORDER BY created_at LIMIT 1) WHERE "project_id" IS NULL;--> statement-breakpoint
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'events_append_only') THEN ALTER TABLE "events" DISABLE TRIGGER "events_append_only"; END IF; END $$;--> statement-breakpoint
UPDATE "events" SET "project_id" = (SELECT id FROM project ORDER BY created_at LIMIT 1) WHERE "project_id" IS NULL;--> statement-breakpoint
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'events_append_only') THEN ALTER TABLE "events" ENABLE TRIGGER "events_append_only"; END IF; END $$;