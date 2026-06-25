"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { getDb } from "@/db/client";
import { unclaimTask } from "@/tasks/claim";
import { claimAndBranch } from "@/tasks/claim-and-branch";

export type ClaimState =
  | { ok: true; branchCreated: boolean }
  | { ok: false; error: string }
  | null;

export async function claim(_prev: ClaimState, formData: FormData): Promise<ClaimState> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Not signed in." };
  const taskId = String(formData.get("taskId"));
  const db = getDb();

  const { claimed, branchCreated } = await claimAndBranch(db, taskId, session.user.id);
  revalidatePath("/tasks");
  revalidatePath("/dashboard");
  if (!claimed) return { ok: false, error: "Task is already claimed." };
  return { ok: true, branchCreated };
}

export async function unclaim(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not signed in.");
  await unclaimTask(getDb(), String(formData.get("taskId")), session.user.id);
  revalidatePath("/tasks");
  revalidatePath("/dashboard");
}
