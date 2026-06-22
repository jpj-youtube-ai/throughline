"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { getDb } from "@/db/client";
import { tasks } from "@/db/schema";
import { claimTask, unclaimTask } from "@/tasks/claim";
import { createBranchesForClaimedTasks } from "@/github/branches";

// Helper: read a task's projectId (used to scope the branch sweep to the right project).
async function getTaskProjectId(db: ReturnType<typeof getDb>, taskId: string): Promise<string | undefined> {
  const [t] = await db.select({ projectId: tasks.projectId }).from(tasks).where(eq(tasks.id, taskId)).limit(1);
  return t?.projectId;
}

export type ClaimState =
  | { ok: true; branchCreated: boolean }
  | { ok: false; error: string }
  | null;

export async function claim(_prev: ClaimState, formData: FormData): Promise<ClaimState> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Not signed in." };
  const taskId = String(formData.get("taskId"));
  const db = getDb();

  const result = await claimTask(db, taskId, session.user.id);
  if (!result.claimed) {
    // Lost the race — someone else holds it. Revalidate so the panel shows the
    // real owner; report failure (no branch warning — the user doesn't hold it).
    revalidatePath("/tasks");
    revalidatePath("/dashboard");
    return { ok: false, error: "Task is already claimed." };
  }

  // External, best-effort (after the claim tx); the worker sweep retries failures.
  // Pass the task's projectId so the branch sweep is scoped to the right project.
  const taskProjectId = await getTaskProjectId(db, taskId);
  try {
    await createBranchesForClaimedTasks(db, taskProjectId);
  } catch {
    // claim holds regardless; leave branch_created_at null for the next sweep.
  }

  revalidatePath("/tasks");
  revalidatePath("/dashboard");

  // Reflect THIS task's branch state (not the sweep's whole key list).
  const [t] = await db.select({ branchCreatedAt: tasks.branchCreatedAt }).from(tasks).where(eq(tasks.id, taskId)).limit(1);
  return { ok: true, branchCreated: Boolean(t?.branchCreatedAt) };
}

export async function unclaim(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not signed in.");
  await unclaimTask(getDb(), String(formData.get("taskId")), session.user.id);
  revalidatePath("/tasks");
  revalidatePath("/dashboard");
}
