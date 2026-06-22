import { eq, isNull } from "drizzle-orm";
import type { Tx } from "../db/client";
import { requirements } from "../db/schema";

// The next monotonic requirement key (REQ-NNN): max existing number within the
// given project + 1, zero-padded to 3 digits. When projectId is null, counts
// requirements that also have no project (bootstrap/no-project scenario). Run
// inside the caller's transaction so the key is still free when the row is
// inserted.
export async function nextRequirementKey(tx: Tx, projectId: string | null): Promise<string> {
  const existing = projectId !== null
    ? await tx.select({ key: requirements.key }).from(requirements).where(eq(requirements.projectId, projectId))
    : await tx.select({ key: requirements.key }).from(requirements).where(isNull(requirements.projectId));
  let max = 0;
  for (const r of existing) {
    const m = /-(\d+)$/.exec(r.key);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `REQ-${String(max + 1).padStart(3, "0")}`;
}
