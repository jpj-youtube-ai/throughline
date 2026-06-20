import { gte } from "drizzle-orm";
import type { Db } from "../db/client";
import { events } from "../db/schema";

const DAY = 86_400_000;

export interface DayBucket {
  t: number; // UTC day start, epoch ms
  count: number;
}

export interface Heartbeat {
  days: DayBucket[];
  total: number;
  activeDays: number;
  busiest: DayBucket | null;
  windowDays: number;
}

function utcDayStart(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/**
 * The project's heartbeat (REQ-022): how many events landed each day across a
 * window, as a continuous series (empty days included, so gaps in the rhythm
 * show). Bucketed by UTC day for determinism. Read-only over the log.
 */
export async function heartbeatSeries(db: Db, now: number = Date.now(), windowDays = 90): Promise<Heartbeat> {
  const start = utcDayStart(now) - (windowDays - 1) * DAY;
  const rows = await db
    .select({ at: events.createdAt })
    .from(events)
    .where(gte(events.createdAt, new Date(start)));

  const counts = new Map<number, number>();
  for (const r of rows) {
    const day = utcDayStart(r.at.getTime());
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }

  const days: DayBucket[] = [];
  for (let i = 0; i < windowDays; i++) {
    const t = start + i * DAY;
    days.push({ t, count: counts.get(t) ?? 0 });
  }

  const total = days.reduce((n, d) => n + d.count, 0);
  const activeDays = days.filter((d) => d.count > 0).length;
  let busiest: DayBucket | null = null;
  for (const d of days) if (d.count > 0 && (!busiest || d.count > busiest.count)) busiest = d;

  return { days, total, activeDays, busiest, windowDays };
}
