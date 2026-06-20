import { eq } from "drizzle-orm";
import { db } from "./client";
import { tasks, requirements } from "./schema";

export interface TaskListItem {
  key: string;
  title: string;
  requirementKey: string;
  // The three metrics are already selected and returned here.
  effort: number;
  risk: "low" | "med" | "high";
  confidence: number;
  claimState: "unclaimed" | "claimed";
  githubStatus: "open" | "closed";
}

// Lists all tasks with their requirement key for the task board.
export async function listTasks(): Promise<TaskListItem[]> {
  return db
    .select({
      key: tasks.key,
      title: tasks.title,
      requirementKey: requirements.key,
      effort: tasks.effort,
      risk: tasks.risk,
      confidence: tasks.confidence,
      claimState: tasks.claimState,
      githubStatus: tasks.githubStatus,
    })
    .from(tasks)
    .innerJoin(requirements, eq(tasks.requirementId, requirements.id));
}
