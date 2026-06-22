// Server-only: the signed-in user's active project for a page/panel (multi-project).
// Kept separate from active.ts so that file's pure unit tests stay free of @/auth.
import { auth } from "@/auth";
import { getDb } from "@/db/client";
import { getActiveProjectId } from "./active";

export async function activeProjectId(): Promise<string> {
  const session = await auth();
  return getActiveProjectId(getDb(), session?.user?.id ?? null);
}
