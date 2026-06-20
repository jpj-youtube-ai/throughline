import { and, eq, asc } from "drizzle-orm";
import type { Db } from "../db/client";
import { tasks, requirements } from "../db/schema";

export interface QuickWin {
  key: string;
  title: string;
  requirementKey: string;
  effort: number; // 1–5
  risk: "low" | "med" | "high";
  confidence: number; // 0–100
  score: number; // 0–100
}

const RISK_FACTOR: Record<string, number> = { low: 1, med: 0.5, high: 0 };

/**
 * Quick-win score (REQ-020): a 0–100 ranking of how good a pickup a task is —
 * high confidence, low effort, low risk. Weighted confidence 50 / effort 30 /
 * risk 20. Pure and explainable (the card shows the three factors behind it).
 */
export function scoreTask(t: { effort: number; risk: string; confidence: number }): number {
  const conf = Math.max(0, Math.min(100, t.confidence)) / 100;
  const ease = (5 - Math.max(1, Math.min(5, t.effort))) / 4; // effort 1 → 1, effort 5 → 0
  const safe = RISK_FACTOR[t.risk] ?? 0.5;
  return Math.round(100 * (0.5 * conf + 0.3 * ease + 0.2 * safe));
}

/**
 * Surface the best unclaimed, open tasks to pick up next, highest score first.
 * Read-only over the board DB.
 */
export async function listQuickWins(db: Db, limit = 8): Promise<QuickWin[]> {
  const rows = await db
    .select({
      key: tasks.key,
      title: tasks.title,
      requirementKey: requirements.key,
      effort: tasks.effort,
      risk: tasks.risk,
      confidence: tasks.confidence,
    })
    .from(tasks)
    .innerJoin(requirements, eq(tasks.requirementId, requirements.id))
    .where(and(eq(tasks.claimState, "unclaimed"), eq(tasks.githubStatus, "open")))
    .orderBy(asc(tasks.key));

  return rows
    .map((r) => ({ ...r, score: scoreTask(r) }))
    .sort((a, b) => b.score - a.score || a.key.localeCompare(b.key))
    .slice(0, limit);
}
