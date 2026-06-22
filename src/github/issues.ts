import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "../db/client";
import { tasks, project } from "../db/schema";
import { openIssue as realOpenIssue } from "./app";
import { listProjects } from "../project/list";

export type OpenIssueFn = (
  installationId: number,
  repoFullName: string,
  title: string,
  body: string,
) => Promise<{ number: number; url: string }>;

export interface CreateIssuesResult {
  created: string[]; // task keys that got an issue this run
}

/**
 * Create a GitHub issue for each task that doesn't have one yet (REQ-009), via
 * the App, and store github_issue_number/url. Idempotent. Runs AFTER the tasks
 * are committed (never inside a DB transaction — an external call can't be rolled
 * back). The board stores the issue ref but never the status (that's webhook-only).
 *
 * `projectId` is optional: when omitted, resolves the oldest project (so existing
 * worker callers keep working without changes).
 */
export async function createIssuesForTasks(
  db: Db,
  projectId?: string,
  openIssue: OpenIssueFn = realOpenIssue,
): Promise<CreateIssuesResult> {
  let resolvedProjectId: string;
  if (projectId) {
    resolvedProjectId = projectId;
  } else {
    const projects = await listProjects(db);
    if (projects.length === 0) throw new Error("No project bound (REQ-002).");
    resolvedProjectId = projects[0].id;
  }

  const [proj] = await db.select().from(project).where(eq(project.id, resolvedProjectId)).limit(1);
  if (!proj) throw new Error(`Project ${resolvedProjectId} not found (REQ-002).`);

  const pending = await db
    .select({ id: tasks.id, key: tasks.key, title: tasks.title, body: tasks.body })
    .from(tasks)
    .where(and(isNull(tasks.githubIssueNumber), eq(tasks.projectId, resolvedProjectId)));

  const created: string[] = [];
  for (const t of pending) {
    const issue = await openIssue(proj.installationId, proj.repoFullName, `[${t.key}] ${t.title}`, t.body);
    await db
      .update(tasks)
      .set({ githubIssueNumber: issue.number, githubIssueUrl: issue.url, updatedAt: new Date() })
      .where(eq(tasks.id, t.id));
    created.push(t.key);
  }
  return { created };
}
