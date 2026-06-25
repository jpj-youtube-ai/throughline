import { desc, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { tasks, requirements } from "../db/schema";

/**
 * A compact, newest-first summary of the project's tasks for the generation
 * context (REQ-008) — `TASK-NNN [open|claimed|closed] — title → REQ-NNN`. Read-only;
 * github_status is only read to label, never written. Capped at `limit` (default 200).
 */
export async function projectTaskSummary(
  db: Db,
  projectId: string,
  opts: { limit?: number } = {},
): Promise<string[]> {
  const limit = opts.limit ?? 200;
  const rows = await db
    .select({
      key: tasks.key,
      title: tasks.title,
      reqKey: requirements.key,
      githubStatus: tasks.githubStatus,
      claimState: tasks.claimState,
    })
    .from(tasks)
    .innerJoin(requirements, eq(tasks.requirementId, requirements.id))
    .where(eq(tasks.projectId, projectId))
    .orderBy(desc(tasks.createdAt))
    .limit(limit);

  return rows.map((r) => {
    const status = r.githubStatus === "closed" ? "closed" : r.claimState === "claimed" ? "claimed" : "open";
    return `${r.key} [${status}] — ${r.title} → ${r.reqKey}`;
  });
}
