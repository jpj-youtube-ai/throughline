import { eq, asc } from "drizzle-orm";
import type { Db } from "../db/client";
import { project, users } from "../db/schema";

/**
 * The project a user is currently working in (multi-project, per-user). Returns
 * the user's active_project_id; if unset (or no user), the oldest project. Throws
 * if no project is bound. Phase A: there is one project, so this always returns it.
 */
export async function getActiveProjectId(db: Db, userId?: string | null): Promise<string> {
  if (userId) {
    const [u] = await db
      .select({ active: users.activeProjectId })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (u?.active) return u.active;
  }
  const [p] = await db
    .select({ id: project.id })
    .from(project)
    .orderBy(asc(project.createdAt))
    .limit(1);
  if (!p) throw new Error("No project bound (REQ-002).");
  return p.id;
}
