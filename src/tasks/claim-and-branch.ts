import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { tasks } from "../db/schema";
import { claimTask } from "./claim";
import { createBranchesForClaimedTasks } from "../github/branches";

type BranchSweep = (db: Db, projectId?: string) => Promise<{ created: string[] }>;

/**
 * Claim a task and (best-effort) create its branch (REQ-010/011). Shared by the
 * /tasks claim action and the spec-map claimFromSpec action — the claim domain
 * (claimTask → task.claimed in-tx) is unchanged; only the callers' revalidation
 * differs. The branch sweep runs OUTSIDE the claim tx (external call); a failure
 * leaves branch_created_at null for the next worker sweep. `branchSweep` is
 * injectable for tests.
 */
export async function claimAndBranch(
  db: Db,
  taskId: string,
  userId: string,
  branchSweep: BranchSweep = createBranchesForClaimedTasks,
): Promise<{ claimed: boolean; branchCreated: boolean }> {
  const result = await claimTask(db, taskId, userId);
  if (!result.claimed) return { claimed: false, branchCreated: false };

  const [t0] = await db.select({ projectId: tasks.projectId }).from(tasks).where(eq(tasks.id, taskId)).limit(1);
  try {
    await branchSweep(db, t0?.projectId ?? undefined);
  } catch {
    // claim holds regardless; leave branch_created_at null for the next sweep.
  }
  const [t] = await db.select({ branchCreatedAt: tasks.branchCreatedAt }).from(tasks).where(eq(tasks.id, taskId)).limit(1);
  return { claimed: true, branchCreated: Boolean(t?.branchCreatedAt) };
}
