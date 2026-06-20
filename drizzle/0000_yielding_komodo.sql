CREATE TYPE "public"."claim_state" AS ENUM('unclaimed', 'claimed');--> statement-breakpoint
CREATE TYPE "public"."drift_resolution" AS ENUM('new_req', 'out_of_scope', 'relink');--> statement-breakpoint
CREATE TYPE "public"."drift_status" AS ENUM('open', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."github_status" AS ENUM('open', 'closed');--> statement-breakpoint
CREATE TYPE "public"."idea_state" AS ENUM('scratch', 'voting', 'approved', 'rejected', 'generated');--> statement-breakpoint
CREATE TYPE "public"."provenance" AS ENUM('imported', 'voted', 'drift');--> statement-breakpoint
CREATE TYPE "public"."requirement_status" AS ENUM('planned', 'building', 'shipped');--> statement-breakpoint
CREATE TYPE "public"."risk_level" AS ENUM('low', 'med', 'high');--> statement-breakpoint
CREATE TABLE "drift_flags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"pr_number" integer NOT NULL,
	"unmapped_items" jsonb NOT NULL,
	"status" "drift_status" DEFAULT 'open' NOT NULL,
	"resolution" "drift_resolution",
	"resolved_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"actor_id" uuid,
	"subject_type" text NOT NULL,
	"subject_id" uuid,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"rationale" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ideas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"why" text,
	"feasibility" integer,
	"viability" integer,
	"author_id" uuid NOT NULL,
	"state" "idea_state" NOT NULL,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "narratives" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_count" integer NOT NULL,
	"content" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repo_full_name" text NOT NULL,
	"default_branch" text NOT NULL,
	"installation_id" bigint NOT NULL,
	"local_clone_path" text NOT NULL,
	"spec_path" text DEFAULT 'SPEC.md' NOT NULL,
	"claude_md_path" text DEFAULT 'CLAUDE.md' NOT NULL,
	"convention_version" integer DEFAULT 1 NOT NULL,
	"digest_webhook_url" text,
	"digest_schedule" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "requirements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"status" "requirement_status" DEFAULT 'planned' NOT NULL,
	"provenance" "provenance" NOT NULL,
	"origin_idea_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "requirements_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"requirement_id" uuid NOT NULL,
	"origin_idea_id" uuid,
	"effort" integer NOT NULL,
	"risk" "risk_level" NOT NULL,
	"confidence" integer NOT NULL,
	"claim_user_id" uuid,
	"claim_state" "claim_state" DEFAULT 'unclaimed' NOT NULL,
	"branch_name" text,
	"github_issue_number" integer,
	"github_issue_url" text,
	"github_status" "github_status" DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tasks_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"github_id" bigint NOT NULL,
	"github_login" text NOT NULL,
	"name" text,
	"avatar_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_github_id_unique" UNIQUE("github_id")
);
--> statement-breakpoint
CREATE TABLE "votes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"idea_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "votes_idea_user_unique" UNIQUE("idea_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "drift_flags" ADD CONSTRAINT "drift_flags_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drift_flags" ADD CONSTRAINT "drift_flags_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ideas" ADD CONSTRAINT "ideas_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirements" ADD CONSTRAINT "requirements_origin_idea_id_ideas_id_fk" FOREIGN KEY ("origin_idea_id") REFERENCES "public"."ideas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_requirement_id_requirements_id_fk" FOREIGN KEY ("requirement_id") REFERENCES "public"."requirements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_origin_idea_id_ideas_id_fk" FOREIGN KEY ("origin_idea_id") REFERENCES "public"."ideas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_claim_user_id_users_id_fk" FOREIGN KEY ("claim_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "votes" ADD CONSTRAINT "votes_idea_id_ideas_id_fk" FOREIGN KEY ("idea_id") REFERENCES "public"."ideas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "votes" ADD CONSTRAINT "votes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;