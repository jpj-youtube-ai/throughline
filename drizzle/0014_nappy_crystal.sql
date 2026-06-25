CREATE TABLE "task_prototypes" (
	"task_id" uuid NOT NULL,
	"prototype_id" uuid NOT NULL,
	CONSTRAINT "task_prototypes_task_id_prototype_id_pk" PRIMARY KEY("task_id","prototype_id")
);
--> statement-breakpoint
ALTER TABLE "task_prototypes" ADD CONSTRAINT "task_prototypes_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_prototypes" ADD CONSTRAINT "task_prototypes_prototype_id_prototypes_id_fk" FOREIGN KEY ("prototype_id") REFERENCES "public"."prototypes"("id") ON DELETE cascade ON UPDATE no action;