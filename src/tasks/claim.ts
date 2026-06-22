import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { tasks } from "../db/schema";
import { emitEvent } from "../db/events";

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50)
    .replace(/-+$/g, "");
}

// Branch convention: task-<key>-<slug>, e.g. TASK-014 "Event log table" ->
// task-014-event-log-table (CLAUDE.md / REQ-011).
export function branchNameFor(key: string, title: string): string {
  return `${key.toLowerCase()}-${slugify(title)}`;
}

export interface ClaimResult {
  claimed: boolean; // false if someone else already had it
  branchName?: string;
}

/**
 * Claim a task (REQ-010): atomic unclaimed -> claimed. The idea row is locked for
 * update and the state re-checked, so two users can't both win. Sets claim_user_id
 * and the branch name, and emits task.claimed.
 */
export async function claimTask(db: Db, taskId: string, userId: string): Promise<ClaimResult> {
  return db.transaction(async (tx) => {
    const [task] = await tx
      .select({ key: tasks.key, title: tasks.title, claimState: tasks.claimState, projectId: tasks.projectId })
      .from(tasks)
      .where(eq(tasks.id, taskId))
      .for("update")
      .limit(1);
    if (!task) throw new Error("Task not found.");
    if (task.claimState === "claimed") return { claimed: false };

    const branchName = branchNameFor(task.key, task.title);
    await tx
      .update(tasks)
      .set({ claimState: "claimed", claimUserId: userId, branchName, updatedAt: new Date() })
      .where(eq(tasks.id, taskId));
    await emitEvent(tx, {
      type: "task.claimed",
      subjectType: "task",
      subjectId: taskId,
      actorId: userId,
      payload: { claimer: userId, branch: branchName },
      projectId: task.projectId ?? undefined,
    });
    return { claimed: true, branchName };
  });
}

export interface UnclaimResult {
  unclaimed: boolean;
}

/** Release a claim (REQ-010) — only the current claimer can. Emits task.unclaimed. */
export async function unclaimTask(db: Db, taskId: string, userId: string): Promise<UnclaimResult> {
  return db.transaction(async (tx) => {
    const [task] = await tx
      .select({ claimState: tasks.claimState, claimUserId: tasks.claimUserId, projectId: tasks.projectId })
      .from(tasks)
      .where(eq(tasks.id, taskId))
      .for("update")
      .limit(1);
    if (!task) throw new Error("Task not found.");
    if (task.claimState !== "claimed") return { unclaimed: false };
    if (task.claimUserId !== userId) throw new Error("Only the claimer can unclaim this task.");

    await tx
      .update(tasks)
      .set({ claimState: "unclaimed", claimUserId: null, branchName: null, branchCreatedAt: null, updatedAt: new Date() })
      .where(eq(tasks.id, taskId));
    await emitEvent(tx, {
      type: "task.unclaimed",
      subjectType: "task",
      subjectId: taskId,
      actorId: userId,
      projectId: task.projectId ?? undefined,
    });
    return { unclaimed: true };
  });
}
