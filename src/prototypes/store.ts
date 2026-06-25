import { and, desc, eq, isNotNull } from "drizzle-orm";
import type { Db } from "../db/client";
import { prototypes } from "../db/schema";
import { emitEvent } from "../db/events";

/** Add a project design prototype (REQ-030): store HTML + emit prototype.added in
 *  one tx. The PNG is rendered later by the worker sweep (no render here). */
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

/** The project's rendered prototypes for the generation context (REQ-030/008) —
 *  newest-first, rendered only, capped. */
export async function loadProjectPrototypes(
  db: Db,
  projectId: string,
  opts: { limit?: number } = {},
): Promise<{ id: string; label: string; image: Buffer }[]> {
  const rows = await db
    .select({ id: prototypes.id, label: prototypes.label, image: prototypes.image })
    .from(prototypes)
    .where(and(eq(prototypes.projectId, projectId), isNotNull(prototypes.image)))
    .orderBy(desc(prototypes.createdAt))
    .limit(opts.limit ?? 6);
  return rows.map((r) => ({ id: r.id, label: r.label, image: Buffer.from(r.image as Uint8Array) }));
}
