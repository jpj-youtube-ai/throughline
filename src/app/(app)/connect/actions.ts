"use server";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { getDb } from "@/db/client";
import { syncClaudeMdForProject } from "@/integrity/claude-md";
import { activeProjectId } from "@/project/current";
import { addPrototype, removePrototype } from "@/prototypes/store";

export type SyncState =
  | { ok: true; status: "synced" | "already-synced" }
  | { ok: false; error: string }
  | null;

// ── Design prototype actions (REQ-030) ──────────────────────────────────────

export type ProtoState = { ok: true } | { ok: false; error: string } | null;

export async function addPrototypeAction(_prev: ProtoState, formData: FormData): Promise<ProtoState> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Not signed in." };
  const label = String(formData.get("label") ?? "").trim();
  const file = formData.get("file");
  if (!label) return { ok: false, error: "Give the prototype a label." };
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Choose an HTML file." };
  const html = await file.text();
  if (!html.trim()) return { ok: false, error: "The file is empty." };
  const db = getDb();
  const pid = await activeProjectId();
  await addPrototype(db, { projectId: pid, label, html, actorId: session.user.id });
  revalidatePath("/connect");
  return { ok: true };
}

export async function removePrototypeAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not signed in.");
  await removePrototype(getDb(), { id: String(formData.get("id")), actorId: session.user.id });
  revalidatePath("/connect");
}

// ── Claude.md sync action ────────────────────────────────────────────────────

export async function syncClaudeMd(_prev: SyncState, formData: FormData): Promise<SyncState> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Not signed in." };
  const projectId = String(formData.get("projectId") ?? "");
  if (!projectId) return { ok: false, error: "Missing project." };
  try {
    const r = await syncClaudeMdForProject(getDb(), projectId);
    revalidatePath("/connect");
    return { ok: true, status: r.status };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Sync failed." };
  }
}
