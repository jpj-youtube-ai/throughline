import type { Db } from "../db/client";
import { emitEvent } from "../db/events";

/**
 * Record a request to regenerate a project's narrative (REQ-016). A pure-intent
 * event — the log is the source of truth for "a regen is pending"; the worker
 * picks it up off the request path. Emitted in its own tx (atomic append).
 */
export async function requestNarrative(db: Db, input: { projectId: string; actorId?: string | null }): Promise<void> {
  await db.transaction(async (tx) => {
    await emitEvent(tx, {
      type: "narrative.requested",
      subjectType: "project",
      subjectId: input.projectId,
      actorId: input.actorId ?? null,
      payload: {},
      projectId: input.projectId,
    });
  });
}
