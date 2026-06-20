import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { tasks } from "../db/schema";
import { emitEvent } from "../db/events";

export interface LogWorkInput {
  summary: string; // what was done
  rationale: string; // the why — mandatory
  actorId: string;
  taskKey?: string | null; // optional TASK-NNN this work relates to
}

/**
 * Record work that happened outside the flow (REQ-025): something done off-platform
 * that the log would otherwise miss. Emits work.logged_retroactively with the why
 * as rationale, in one transaction. This is a pure record — it changes no current
 * state, it fills a gap in the history — so the event is the whole artifact.
 */
export async function logWorkRetroactively(db: Db, input: LogWorkInput): Promise<{ id: string }> {
  const summary = input.summary.trim();
  const rationale = input.rationale?.trim() ?? "";
  if (!summary) throw new Error("Say what was done.");
  if (!rationale) throw new Error("Logging past work needs a why.");

  return db.transaction(async (tx) => {
    let subjectType = "project";
    let subjectId: string | null = null;
    let taskKey: string | null = null;

    const requested = input.taskKey?.trim();
    if (requested) {
      const key = requested.toUpperCase();
      const [task] = await tx.select({ id: tasks.id, key: tasks.key }).from(tasks).where(eq(tasks.key, key)).limit(1);
      if (!task) throw new Error(`No task ${key} to attach this to.`);
      subjectType = "task";
      subjectId = task.id;
      taskKey = task.key;
    }

    return emitEvent(tx, {
      type: "work.logged_retroactively",
      subjectType,
      subjectId,
      actorId: input.actorId,
      payload: { summary, task_key: taskKey },
      rationale,
    });
  });
}
