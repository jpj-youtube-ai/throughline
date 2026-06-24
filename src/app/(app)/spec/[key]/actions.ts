"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { getDb } from "@/db/client";
import { requirements } from "@/db/schema";
import { generateForRequirementKey } from "@/generation/orchestrate";
import { createIssuesForTasks } from "@/github/issues";
import { activeProjectId } from "@/project/current";
import { getRequirementDetail } from "@/spec/detail";
import { generateRequirementDiagramHtml } from "@/spec/diagram";

export type GenState = { ok: true; taskKeys: string[] } | { ok: false; error: string } | null;

export async function generateTasksForRequirement(_prev: GenState, formData: FormData): Promise<GenState> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Not signed in." };

  const key = String(formData.get("key") ?? "");
  const db = getDb();
  // Resolve the requirement WITHIN the active project — `key` alone is ambiguous
  // across projects (every project has its own REQ-001…), so a bare-key lookup can
  // land on another project's same-keyed requirement (which may already have tasks).
  const pid = await activeProjectId();
  const r = await generateForRequirementKey(db, pid, key);
  if (!r.ok) return { ok: false, error: r.failure ?? "Generation failed." };

  // Open GitHub issues for the new tasks (idempotent; outside the generation tx).
  // Scope to the active project so issues land on the right project's repo.
  try {
    await createIssuesForTasks(db, pid);
  } catch {
    // tasks are persisted; issue creation can be retried by the worker — don't fail the action.
  }

  revalidatePath("/spec");
  revalidatePath("/dashboard");
  revalidatePath(`/spec/${key}`);
  return { ok: true, taskKeys: r.taskKeys ?? [] };
}

export type DiagramState = { ok: true; html: string } | { ok: false; error: string } | null;

export async function generateRequirementDiagram(_prev: DiagramState, formData: FormData): Promise<DiagramState> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Not signed in." };

  const key = String(formData.get("key") ?? "");
  const db = getDb();
  const pid = await activeProjectId();
  const detail = await getRequirementDetail(db, pid, key);
  if (!detail) return { ok: false, error: `Unknown requirement ${key}.` };

  const html = await generateRequirementDiagramHtml({
    key: detail.key,
    title: detail.title,
    description: detail.description,
    tasks: detail.tasks.map((t) => ({ key: t.key, title: t.title, status: t.githubStatus })),
  });
  if (!html) return { ok: false, error: "Couldn't generate a diagram — try again." };

  await db.update(requirements).set({ diagramHtml: html }).where(eq(requirements.id, detail.id));

  revalidatePath(`/spec/${key}`);
  revalidatePath("/spec");
  revalidatePath("/dashboard");
  return { ok: true, html };
}
