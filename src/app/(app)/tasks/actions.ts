"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { getDb } from "@/db/client";
import { tasks } from "@/db/schema";
import { claimTask, unclaimTask } from "@/tasks/claim";
import { createBranchesForClaimedTasks } from "@/github/branches";

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
  if (result.claimed) {
    // External, best-effort (after the claim tx); the worker sweep retries failures.
    try {
      await createBranchesForClaimedTasks(db);
    } catch {
      // claim holds regardless; leave branch_created_at null for the next sweep.
    }
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
