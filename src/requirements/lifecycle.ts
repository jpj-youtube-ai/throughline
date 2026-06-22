import { eq } from "drizzle-orm";
import type { Tx } from "../db/client";
import { requirements, tasks } from "../db/schema";
import { emitEvent } from "../db/events";

export type RequirementStatus = "planned" | "building" | "shipped";

/**
 * Derive a requirement's status from its tasks and record any transition
 * (REQ-021). A requirement with no tasks stays `planned`; with at least one task
 * it is `building`, and `shipped` once every task is merged (github closed).
 * Idempotent — only writes (and emits requirement.status_changed) on a real
 * change. Must run inside the transaction that changed the triggering task, so
 * the status and its event are written atomically with the cause.
 *
 * This is the only writer of requirement.status, and the closing of the gap
 * where requirement status was set at declaration and never advanced.
 */
export async function reconcileRequirementStatus(
  tx: Tx,
  requirementId: string,
  actorId: string | null = null,
): Promise<RequirementStatus | null> {
  const [req] = await tx
    .select({ status: requirements.status, projectId: requirements.projectId })
    .from(requirements)
    .where(eq(requirements.id, requirementId))
    .for("update")
    .limit(1);
  if (!req) return null;

  const taskRows = await tx
    .select({ githubStatus: tasks.githubStatus })
    .from(tasks)
    .where(eq(tasks.requirementId, requirementId));
  if (taskRows.length === 0) return null; // no work yet — leave it planned

  const desired: RequirementStatus = taskRows.every((t) => t.githubStatus === "closed") ? "shipped" : "building";
  if (req.status === desired) return null;

  await tx.update(requirements).set({ status: desired, updatedAt: new Date() }).where(eq(requirements.id, requirementId));
  await emitEvent(tx, {
    type: "requirement.status_changed",
    subjectType: "requirement",
    subjectId: requirementId,
    actorId,
    payload: { from: req.status, to: desired },
    projectId: req.projectId ?? undefined,
  });
  return desired;
}
