import { asc, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { project } from "../db/schema";
import { commitFileInClone } from "../github/commit";

/**
 * Write the materialized spec into the bound repo's local clone and commit it,
 * returning the commit sha (REQ-012). Commits to the clone; pushing / opening a
 * PR is left to the App flow. When projectId is given the commit targets that
 * project's clone; otherwise defaults to the oldest project.
 */
export async function repoCommit(db: Db, projectId: string | undefined, content: string): Promise<{ sha: string }> {
  let proj: { localClonePath: string; specPath: string } | undefined;
  if (projectId) {
    const [p] = await db.select({ localClonePath: project.localClonePath, specPath: project.specPath }).from(project).where(eq(project.id, projectId)).limit(1);
    proj = p;
  } else {
    const [p] = await db.select({ localClonePath: project.localClonePath, specPath: project.specPath }).from(project).orderBy(asc(project.createdAt)).limit(1);
    proj = p;
  }
  if (!proj) throw new Error("No project bound (REQ-002).");
  return commitFileInClone(proj.localClonePath, proj.specPath, content, "[spec] materialize requirements");
}
