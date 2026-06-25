import { desc, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { prototypes, taskPrototypes } from "../db/schema";
import { emitEvent } from "../db/events";

/** Add a project design prototype (REQ-030): store HTML + emit prototype.added in
 *  one tx. HTML is stored as-is; no image rendering. */
export async function addPrototype(
  db: Db,
  input: { projectId: string; label: string; html: string; actorId?: string | null },
): Promise<{ id: string }> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(prototypes)
      .values({ projectId: input.projectId, label: input.label, html: input.html })
      .returning({ id: prototypes.id });
    await emitEvent(tx, {
      type: "prototype.added",
      subjectType: "prototype",
      subjectId: row.id,
      actorId: input.actorId ?? null,
      payload: { label: input.label },
      projectId: input.projectId,
    });
    return row;
  });
}

/** Remove a prototype (REQ-030): delete + emit prototype.removed in one tx. */
export async function removePrototype(
  db: Db,
  input: { id: string; actorId?: string | null },
): Promise<{ removed: boolean }> {
  const [row] = await db.select({ projectId: prototypes.projectId, label: prototypes.label }).from(prototypes).where(eq(prototypes.id, input.id)).limit(1);
  if (!row) return { removed: false };
  await db.transaction(async (tx) => {
    await tx.delete(prototypes).where(eq(prototypes.id, input.id));
    await emitEvent(tx, {
      type: "prototype.removed",
      subjectType: "prototype",
      subjectId: input.id,
      actorId: input.actorId ?? null,
      payload: { label: row.label },
      projectId: row.projectId,
    });
  });
  return { removed: true };
}

/** The prototypes a task is linked to (REQ-030) — id, label, and the HTML to
 *  commit onto the task's branch. */
export async function loadTaskPrototypes(
  db: Db,
  taskId: string,
): Promise<{ id: string; label: string; html: string }[]> {
  return db
    .select({ id: prototypes.id, label: prototypes.label, html: prototypes.html })
    .from(taskPrototypes)
    .innerJoin(prototypes, eq(prototypes.id, taskPrototypes.prototypeId))
    .where(eq(taskPrototypes.taskId, taskId));
}

/** Load prototypes for a project (REQ-030) — id and label only, newest-first. */
export async function loadProjectPrototypes(
  db: Db,
  projectId: string,
): Promise<{ id: string; label: string }[]> {
  return db
    .select({ id: prototypes.id, label: prototypes.label })
    .from(prototypes)
    .where(eq(prototypes.projectId, projectId))
    .orderBy(desc(prototypes.createdAt));
}
