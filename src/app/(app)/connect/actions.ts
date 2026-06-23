"use server";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { getDb } from "@/db/client";
import { syncClaudeMdForProject } from "@/integrity/claude-md";

export type SyncState =
  | { ok: true; status: "synced" | "already-synced" }
  | { ok: false; error: string }
  | null;

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
