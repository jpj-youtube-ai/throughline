import { eq, asc, and } from "drizzle-orm";
import type { Db } from "../db/client";
import { requirements, tasks } from "../db/schema";

export interface RequirementDetail {
  id: string;
  key: string;
  title: string;
  description: string;
  status: "planned" | "building" | "shipped";
  provenance: "imported" | "voted" | "drift";
  tasks: { key: string; title: string; githubStatus: "open" | "closed"; claimState: "unclaimed" | "claimed"; githubIssueUrl: string | null }[];
}

// One requirement + its tasks (for the spec detail drawer). null if the key is unknown.
// projectId is required because key alone is ambiguous across projects.
export async function getRequirementDetail(db: Db, projectId: string, key: string): Promise<RequirementDetail | null> {
  const [req] = await db
    .select({ id: requirements.id, key: requirements.key, title: requirements.title, description: requirements.description, status: requirements.status, provenance: requirements.provenance })
    .from(requirements)
    .where(and(eq(requirements.projectId, projectId), eq(requirements.key, key)))
    .limit(1);
  if (!req) return null;

  const taskRows = await db
    .select({ key: tasks.key, title: tasks.title, githubStatus: tasks.githubStatus, claimState: tasks.claimState, githubIssueUrl: tasks.githubIssueUrl })
    .from(tasks)
    .where(and(eq(tasks.requirementId, req.id), eq(tasks.projectId, projectId)))
    .orderBy(asc(tasks.key));

  return { ...req, tasks: taskRows };
}
