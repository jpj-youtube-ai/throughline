import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { project } from "../db/schema";
import { getInstallationToken } from "../github/app";
import { ensureClone } from "../github/clone";

/**
 * Refresh a project's local clone to the latest default branch before generation
 * (REQ-008), so the slice / spec / CLAUDE.md and the git-log context aren't stale
 * (which makes the model re-propose already-done work). Throws on failure; callers
 * run it best-effort. Mirrors the bind-time clone in src/project/connect.ts.
 */
export async function refreshProjectClone(db: Db, projectId: string): Promise<void> {
  const [proj] = await db.select().from(project).where(eq(project.id, projectId)).limit(1);
  if (!proj) throw new Error(`Project ${projectId} not found (REQ-002).`);
  const token = await getInstallationToken(proj.installationId);
  await ensureClone({
    repoFullName: proj.repoFullName,
    dir: proj.localClonePath,
    token,
    defaultBranch: proj.defaultBranch,
  });
}
