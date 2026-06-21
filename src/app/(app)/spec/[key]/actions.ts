"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { getDb } from "@/db/client";
import { requirements } from "@/db/schema";
import { generateForRequirement } from "@/generation/orchestrate";
import { createIssuesForTasks } from "@/github/issues";

export type GenState = { ok: true; taskKeys: string[] } | { ok: false; error: string } | null;

export async function generateTasksForRequirement(_prev: GenState, formData: FormData): Promise<GenState> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Not signed in." };

  const key = String(formData.get("key") ?? "");
  const db = getDb();
  const [req] = await db.select({ id: requirements.id }).from(requirements).where(eq(requirements.key, key)).limit(1);
  if (!req) return { ok: false, error: `Unknown requirement ${key}.` };

  const r = await generateForRequirement(db, req.id);
  if (!r.ok) return { ok: false, error: r.failure ?? "Generation failed." };

  // Open GitHub issues for the new tasks (idempotent; outside the generation tx).
  try {
    await createIssuesForTasks(db);
  } catch {
    // tasks are persisted; issue creation can be retried by the worker — don't fail the action.
  }

  revalidatePath("/spec");
  revalidatePath("/dashboard");
  revalidatePath(`/spec/${key}`);
  return { ok: true, taskKeys: r.taskKeys ?? [] };
}
