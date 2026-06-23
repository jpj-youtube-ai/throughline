import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { project } from "../db/schema";
import { emitEvent } from "../db/events";
import { matchPins } from "../repoSlice";

/** Clean operator input into a stable pin list: trim, posix separators, drop
 *  empties, dedupe (first occurrence wins). Accepts a textarea string or array. */
export function normalizePins(raw: string | string[]): string[] {
  const items = Array.isArray(raw) ? raw : raw.split(/\r?\n/);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const v = item.trim().replace(/\\/g, "/").replace(/^\.\//, "");
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

export interface SetContextPinsResult {
  pins: string[];
  matched: number;
  total: number;
}

/**
 * Set a project's context pins (REQ-008). Normalizes input, records the pins on
 * the project, and emits `project.context_pins_changed` in the same transaction.
 * Returns advisory match feedback (how many pins resolve to a real file in the
 * clone) — unmatched pins are stored, not rejected; the slice ignores them.
 */
export async function setContextPins(
  db: Db,
  input: { projectId: string; pins: string | string[]; actorId?: string | null },
): Promise<SetContextPinsResult> {
  const pins = normalizePins(input.pins);

  const [proj] = await db
    .select({ id: project.id, localClonePath: project.localClonePath })
    .from(project)
    .where(eq(project.id, input.projectId))
    .limit(1);
  if (!proj) throw new Error(`Project ${input.projectId} not found.`);

  const matched = matchPins(proj.localClonePath, pins).length;

  await db.transaction(async (tx) => {
    await tx.update(project).set({ contextPins: pins }).where(eq(project.id, proj.id));
    await emitEvent(tx, {
      type: "project.context_pins_changed",
      subjectType: "project",
      subjectId: proj.id,
      actorId: input.actorId ?? null,
      payload: { pins, count: pins.length },
      projectId: proj.id,
    });
  });

  return { pins, matched, total: pins.length };
}
