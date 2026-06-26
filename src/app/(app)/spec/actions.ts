// src/app/(app)/spec/actions.ts
"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { getDb } from "@/db/client";
import { importGenesisSpec, parseSpecRequirements } from "@/genesis/import";
import { classifyForMerge, mergeBranchSpec } from "@/requirements/merge";
import { requirements } from "@/db/schema";
import { getActiveProjectId } from "@/project/active";

export type ImportState =
  | { ok: true; count: number; keys: string[] }
  | { ok: false; error: string }
  | null;

// Import the genesis spec from the browser (REQ-004's in-app surface). Accepts a
// .md file or pasted text; delegates to importGenesisSpec (one-time bootstrap that
// emits project.genesis_imported + a requirement.declared each, in one tx).
export async function importSpec(_prev: ImportState, formData: FormData): Promise<ImportState> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Not signed in." };
  const file = formData.get("file");
  let text = "";
  let filename = "pasted-spec.md";
  if (file instanceof File && file.size > 0) {
    text = await file.text();
    filename = file.name || filename;
  } else {
    text = String(formData.get("text") ?? "");
  }
  if (!text.trim()) return { ok: false, error: "Paste the spec markdown or choose a file." };
  try {
    const db = getDb();
    const projectId = await getActiveProjectId(db, session.user.id);
    const r = await importGenesisSpec(db, text, filename, projectId);
    revalidatePath("/spec");
    revalidatePath("/dashboard");
    return { ok: true, count: r.count, keys: r.keys };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Import failed." };
  }
}

export type BranchPreviewState =
  | { ok: true; filename: string; toAdd: string[]; toSkip: { title: string; existingKey: string }[]; rawText: string }
  | { ok: false; error: string }
  | null;

// Preview a branch-spec merge (REQ-032): parse + classify against the active
// project's requirements. Read-only — writes nothing. Echoes rawText so the
// confirm step re-parses the exact same input.
export async function previewBranchSpec(_prev: BranchPreviewState, formData: FormData): Promise<BranchPreviewState> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Not signed in." };
  const file = formData.get("file");
  let text = "";
  let filename = "branch-spec.md";
  if (file instanceof File && file.size > 0) {
    text = await file.text();
    filename = file.name || filename;
  } else {
    text = String(formData.get("text") ?? "");
  }
  if (!text.trim()) return { ok: false, error: "Paste the branch spec markdown or choose a file." };
  try {
    const db = getDb();
    const projectId = await getActiveProjectId(db, session.user.id);
    const parsed = parseSpecRequirements(text);
    if (parsed.length === 0) return { ok: false, error: "No requirements found (expected **REQ-NNN — Title.** headings)." };
    const existing = await db
      .select({ id: requirements.id, key: requirements.key, title: requirements.title })
      .from(requirements)
      .where(eq(requirements.projectId, projectId));
    const { toAdd, toSkip } = classifyForMerge(existing, parsed);
    return {
      ok: true,
      filename,
      toAdd: toAdd.map((r) => r.title),
      toSkip: toSkip.map((s) => ({ title: s.req.title, existingKey: s.existing.key })),
      rawText: text,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Preview failed." };
  }
}

export type BranchMergeState =
  | { ok: true; addedCount: number; skippedCount: number; addedKeys: string[] }
  | { ok: false; error: string }
  | null;

// Commit a previewed branch-spec merge (REQ-032): re-parse the same raw text
// server-side (never trust client-sent requirement data) and run mergeBranchSpec.
export async function commitBranchSpec(_prev: BranchMergeState, formData: FormData): Promise<BranchMergeState> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Not signed in." };
  const text = String(formData.get("rawText") ?? "");
  const filename = String(formData.get("filename") ?? "branch-spec.md");
  if (!text.trim()) return { ok: false, error: "Nothing to merge — preview a spec first." };
  try {
    const db = getDb();
    const projectId = await getActiveProjectId(db, session.user.id);
    const r = await mergeBranchSpec(db, text, filename, projectId);
    revalidatePath("/spec");
    revalidatePath("/dashboard");
    return { ok: true, addedCount: r.added.length, skippedCount: r.skipped.length, addedKeys: r.added.map((a) => a.key) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Merge failed." };
  }
}
