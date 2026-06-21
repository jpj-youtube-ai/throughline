"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { getDb } from "@/db/client";
import { claimTask, unclaimTask } from "@/tasks/claim";

export async function claim(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not signed in.");
  await claimTask(getDb(), String(formData.get("taskId")), session.user.id);
  revalidatePath("/tasks");
  revalidatePath("/dashboard");
}

export async function unclaim(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not signed in.");
  await unclaimTask(getDb(), String(formData.get("taskId")), session.user.id);
  revalidatePath("/tasks");
  revalidatePath("/dashboard");
}
