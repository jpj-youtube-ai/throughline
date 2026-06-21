import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { driftFlags, requirements, tasks } from "../db/schema";
import { emitEvent } from "../db/events";
import { nextRequirementKey } from "../requirements/keys";

export interface FlagDriftInput {
  taskId: string;
  prNumber: number;
  unmappedItems: string[];
}

/**
 * Record a drift flag (REQ-013): work in a PR that maps to no requirement. Flags
 * only — never rewrites the spec. Emits drift.flagged. Returns null (no flag) when
 * there is nothing unmapped.
 */
export async function flagDrift(db: Db, input: FlagDriftInput): Promise<{ id: string } | null> {
  if (input.unmappedItems.length === 0) return null;
  return db.transaction(async (tx) => {
    const [task] = await tx.select({ key: tasks.key }).from(tasks).where(eq(tasks.id, input.taskId)).limit(1);
    if (!task) throw new Error("Task not found.");

    const [row] = await tx
      .insert(driftFlags)
      .values({ taskId: input.taskId, prNumber: input.prNumber, unmappedItems: input.unmappedItems, status: "open" })
      .returning({ id: driftFlags.id });
    await emitEvent(tx, {
      type: "drift.flagged",
      subjectType: "task",
      subjectId: input.taskId,
      payload: { task_key: task.key, pr_number: input.prNumber, unmapped_items: input.unmappedItems },
    });
    return { id: row.id };
  });
}

export type DriftResolution = "new_req" | "out_of_scope" | "relink";

export interface ResolveDriftInput {
  flagId: string;
  resolution: DriftResolution;
  resolvedBy: string;
  rationale: string; // the why — mandatory
  newReqTitle?: string; // new_req
  newReqDescription?: string; // new_req
  relinkReqKey?: string; // relink — target existing REQ
}

export interface ResolveDriftResult {
  resolution: DriftResolution;
  newReqKey?: string;
}

/**
 * Resolve a drift flag with a human decision + rationale (REQ-013). No spec change
 * happens without one of the three paths:
 *  - new_req: declare a REQ-NNN (provenance=drift) for the extra work,
 *  - relink: point the task at a different existing requirement,
 *  - out_of_scope: acknowledge, no spec change.
 * Records the decision in drift_flags and emits drift.resolved.
 */
export async function resolveDrift(db: Db, input: ResolveDriftInput): Promise<ResolveDriftResult> {
  if (!input.rationale?.trim()) throw new Error("Resolving drift requires a rationale (the why).");

  return db.transaction(async (tx) => {
    const [flag] = await tx
      .select({ taskId: driftFlags.taskId, status: driftFlags.status })
      .from(driftFlags)
      .where(eq(driftFlags.id, input.flagId))
      .for("update")
      .limit(1);
    if (!flag) throw new Error("Drift flag not found.");
    if (flag.status === "resolved") throw new Error("Drift flag already resolved.");

    let newReqKey: string | undefined;

    if (input.resolution === "new_req") {
      if (!input.newReqTitle?.trim()) throw new Error("new_req resolution needs a requirement title.");
      newReqKey = await nextRequirementKey(tx);
      const [req] = await tx
        .insert(requirements)
        .values({
          key: newReqKey,
          title: input.newReqTitle,
          description: input.newReqDescription ?? "",
          status: "planned",
          provenance: "drift",
        })
        .returning({ id: requirements.id });
      await emitEvent(tx, {
        type: "requirement.declared",
        subjectType: "requirement",
        subjectId: req.id,
        actorId: input.resolvedBy,
        payload: { provenance: "drift", key: newReqKey, origin_idea_id: null },
      });
    } else if (input.resolution === "relink") {
      if (!input.relinkReqKey) throw new Error("relink resolution needs a target requirement key.");
      const [req] = await tx
        .select({ id: requirements.id })
        .from(requirements)
        .where(eq(requirements.key, input.relinkReqKey))
        .limit(1);
      if (!req) throw new Error(`Requirement ${input.relinkReqKey} not found.`);
      await tx.update(tasks).set({ requirementId: req.id, updatedAt: new Date() }).where(eq(tasks.id, flag.taskId));
    }
    // out_of_scope: acknowledge only.

    await tx
      .update(driftFlags)
      .set({
        status: "resolved",
        resolution: input.resolution,
        resolvedBy: input.resolvedBy,
        resolvedAt: new Date(),
      })
      .where(eq(driftFlags.id, input.flagId));
    await emitEvent(tx, {
      type: "drift.resolved",
      subjectType: "task",
      subjectId: flag.taskId,
      actorId: input.resolvedBy,
      payload: { resolution: input.resolution, new_req_key: newReqKey ?? null },
      rationale: input.rationale.trim(),
    });

    return { resolution: input.resolution, newReqKey };
  });
}
