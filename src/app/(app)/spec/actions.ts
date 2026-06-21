// src/app/(app)/spec/actions.ts
"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db/client";
import { importGenesisSpec } from "@/genesis/import";

export type ImportState =
  | { ok: true; count: number; keys: string[] }
  | { ok: false; error: string }
  | null;

// Import the genesis spec from the browser (REQ-004's in-app surface). Accepts a
// .md file or pasted text; delegates to importGenesisSpec (one-time bootstrap that
// emits project.genesis_imported + a requirement.declared each, in one tx).
export async function importSpec(_prev: ImportState, formData: FormData): Promise<ImportState> {
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
    const r = await importGenesisSpec(getDb(), text, filename);
    revalidatePath("/spec");
    revalidatePath("/dashboard");
    return { ok: true, count: r.count, keys: r.keys };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Import failed." };
  }
}
