import { and, asc, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { tasks, events } from "../db/schema";

export interface BurnPoint {
  t: number; // epoch ms
  scope: number; // cumulative tasks created
  done: number; // cumulative tasks merged
}

export interface BurnUp {
  points: BurnPoint[];
  scope: number;
  done: number;
}

/**
 * Burn-up series (REQ-018), grounded in the log: scope = tasks created over time
 * (their createdAt); done = tasks merged over time (the first
 * task.github_status_changed → closed per task, from the webhook). Cumulative,
 * time-ordered. Requirements have no shipped-transition yet, so tasks are the
 * honest unit of progress.
 */
export async function burnUpSeries(db: Db, projectId?: string): Promise<BurnUp> {
  const taskRows = await db
    .select({ at: tasks.createdAt })
    .from(tasks)
    .where(projectId ? eq(tasks.projectId, projectId) : undefined)
    .orderBy(asc(tasks.createdAt));
  const closeRows = await db
    .select({ at: events.createdAt, subjectId: events.subjectId, payload: events.payload })
    .from(events)
    .where(
      projectId
        ? and(eq(events.type, "task.github_status_changed"), eq(events.projectId, projectId))
        : eq(events.type, "task.github_status_changed"),
    )
    .orderBy(asc(events.seq));

  // first time each task reached "closed"
  const firstClose = new Map<string, Date>();
  for (const r of closeRows) {
    if (r.subjectId && r.payload?.to === "closed" && !firstClose.has(r.subjectId)) {
      firstClose.set(r.subjectId, r.at);
    }
  }

  type Delta = { t: number; ds: number; dd: number };
  const deltas: Delta[] = [];
  for (const r of taskRows) deltas.push({ t: r.at.getTime(), ds: 1, dd: 0 });
  for (const at of firstClose.values()) deltas.push({ t: at.getTime(), ds: 0, dd: 1 });
  deltas.sort((a, b) => a.t - b.t);

  const points: BurnPoint[] = [];
  let scope = 0;
  let done = 0;
  for (const d of deltas) {
    scope += d.ds;
    done += d.dd;
    const last = points[points.length - 1];
    if (last && last.t === d.t) {
      last.scope = scope;
      last.done = done;
    } else {
      points.push({ t: d.t, scope, done });
    }
  }

  return { points, scope, done };
}
