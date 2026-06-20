import { eq, asc } from "drizzle-orm";
import type { Db } from "../db/client";
import { tasks, requirements, users } from "../db/schema";

export interface TaskListItem {
  id: string;
  key: string;
  title: string;
  requirementKey: string;
  effort: number;
  risk: "low" | "med" | "high";
  confidence: number;
  claimState: "unclaimed" | "claimed";
  claimerLogin: string | null;
  branchName: string | null;
  githubStatus: "open" | "closed";
  githubIssueUrl: string | null;
}

// The task board (REQ-010): tasks with their REQ link, the three metrics, claim
// state (+ claimer/branch), and the mirrored GitHub status.
export async function listTasks(db: Db): Promise<TaskListItem[]> {
  return db
    .select({
      id: tasks.id,
      key: tasks.key,
      title: tasks.title,
      requirementKey: requirements.key,
      effort: tasks.effort,
      risk: tasks.risk,
      confidence: tasks.confidence,
      claimState: tasks.claimState,
      claimerLogin: users.githubLogin,
      branchName: tasks.branchName,
      githubStatus: tasks.githubStatus,
      githubIssueUrl: tasks.githubIssueUrl,
    })
    .from(tasks)
    .innerJoin(requirements, eq(tasks.requirementId, requirements.id))
    .leftJoin(users, eq(tasks.claimUserId, users.id))
    .orderBy(asc(tasks.key));
}
