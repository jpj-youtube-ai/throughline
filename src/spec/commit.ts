import type { Db } from "../db/client";
import { project } from "../db/schema";
import { commitFileInClone } from "../github/commit";

/**
 * Write the materialized spec into the bound repo's local clone and commit it,
 * returning the commit sha (REQ-012). Commits to the clone; pushing / opening a
 * PR is left to the App flow.
 */
export async function repoCommit(db: Db, content: string): Promise<{ sha: string }> {
  const [proj] = await db.select().from(project).limit(1);
  if (!proj) throw new Error("No project bound (REQ-002).");
  return commitFileInClone(proj.localClonePath, proj.specPath, content, "[spec] materialize requirements");
}
