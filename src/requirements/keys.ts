import type { Tx } from "../db/client";
import { requirements } from "../db/schema";

// The next monotonic requirement key (REQ-NNN): max existing number + 1,
// zero-padded to 3 digits. Run inside the caller's transaction so the key is
// still free when the row is inserted.
export async function nextRequirementKey(tx: Tx): Promise<string> {
  const existing = await tx.select({ key: requirements.key }).from(requirements);
  let max = 0;
  for (const r of existing) {
    const m = /-(\d+)$/.exec(r.key);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `REQ-${String(max + 1).padStart(3, "0")}`;
}
