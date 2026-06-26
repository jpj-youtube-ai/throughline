import { and, eq, max } from "drizzle-orm";
import type { Db } from "../db/client";
import { events } from "../db/schema";
import { emitEvent } from "../db/events";
import { materializeNarrative } from "./materialize";

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

async function maxSeq(db: Db, projectId: string, type: "narrative.requested" | "narrative.generated"): Promise<number | null> {
  const [row] = await db.select({ seq: max(events.seq) }).from(events).where(and(eq(events.projectId, projectId), eq(events.type, type)));
  return row?.seq ?? null;
}

/** A project's narrative regen is pending when a request was logged after its last
 *  generated narrative (REQ-016). Uses monotonic event seq, not wall-clock. */
export async function narrativeRegenPending(db: Db, projectId: string): Promise<boolean> {
  const reqSeq = await maxSeq(db, projectId, "narrative.requested");
  if (reqSeq == null) return false;
  const genSeq = await maxSeq(db, projectId, "narrative.generated");
  return genSeq == null || reqSeq > genSeq;
}

/** Regenerate a project's narrative iff a request is pending (REQ-016). The
 *  materialize fn is injectable for tests. */
export async function materializeNarrativeIfRequested(
  db: Db,
  projectId: string,
  materialize: (db: Db, projectId: string) => Promise<unknown> = materializeNarrative,
): Promise<{ regenerated: boolean }> {
  if (!(await narrativeRegenPending(db, projectId))) return { regenerated: false };
  await materialize(db, projectId);
  return { regenerated: true };
}
