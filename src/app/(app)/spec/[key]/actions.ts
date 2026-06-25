"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { getDb } from "@/db/client";
import { requirements } from "@/db/schema";
import { generateForRequirementKey } from "@/generation/orchestrate";
import { activeProjectId } from "@/project/current";
import { refreshProjectClone } from "@/project/refresh";
import { getRequirementDetail } from "@/spec/detail";
import { generateRequirementDiagramHtml } from "@/spec/diagram";
import { claimAndBranch } from "@/tasks/claim-and-branch";
import type { ClaimState } from "../../tasks/actions";

export interface GenTask {
  id: string;
  key: string;
  title: string;
  claimState: "unclaimed" | "claimed";
}
export type GenState = { ok: true; tasks: GenTask[] } | { ok: false; error: string } | null;

export async function generateTasksForRequirement(_prev: GenState, formData: FormData): Promise<GenState> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Not signed in." };

  const key = String(formData.get("key") ?? "");
  const db = getDb();
  // Resolve the requirement WITHIN the active project — `key` alone is ambiguous
  // across projects (every project has its own REQ-001…), so a bare-key lookup can
  // land on another project's same-keyed requirement (which may already have tasks).
  const pid = await activeProjectId();
  // Refresh the clone so generation sees the latest merged code (REQ-008). Best-effort.
  try {
    await refreshProjectClone(db, pid);
  } catch (e) {
    console.error("[spec] clone refresh skipped:", e instanceof Error ? e.message : e);
  }
  const r = await generateForRequirementKey(db, pid, key);
  if (!r.ok) return { ok: false, error: r.failure ?? "Generation failed." };

  // Issue creation (and previews) is the WORKER's job: every tick it opens an issue
  // for each task without one (REQ-009). The action must NOT also create issues — it
  // would race the worker (both see the new tasks with github_issue_number IS NULL and
  // each opens one → duplicate issues, observed for NBCC). The worker picks these tasks
  // up within one tick. Keeping this slow, external work off the request path also means
  // the action returns as soon as tasks are persisted.

  // Re-fetch the requirement's tasks (now persisted, with ids) so they render
  // inline with claim controls — the detail sits in an intercepted drawer that
  // doesn't re-render on revalidate, so we return the data directly.
  const detail = await getRequirementDetail(db, pid, key);
  const genTasks: GenTask[] = (detail?.tasks ?? []).map((t) => ({
    id: t.id,
    key: t.key,
    title: t.title,
    claimState: t.claimState,
  }));

  revalidatePath("/spec");
  revalidatePath("/dashboard");
  revalidatePath(`/spec/${key}`);
  return { ok: true, tasks: genTasks };
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

// Claim a task from the spec-map requirement detail (REQ-010). Same claim domain
// as the /tasks board (claimAndBranch); revalidates the spec routes so the detail
// reflects the new claim.
export async function claimFromSpec(_prev: ClaimState, formData: FormData): Promise<ClaimState> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Not signed in." };
  const taskId = String(formData.get("taskId"));
  const key = String(formData.get("key") ?? "");
  const db = getDb();

  const { claimed, branchCreated } = await claimAndBranch(db, taskId, session.user.id);
  revalidatePath("/spec");
  revalidatePath("/dashboard");
  revalidatePath("/tasks");
  if (key) revalidatePath(`/spec/${key}`);
  if (!claimed) return { ok: false, error: "Task is already claimed." };
  return { ok: true, branchCreated };
}
