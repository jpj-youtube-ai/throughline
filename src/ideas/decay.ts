const DAY = 86_400_000;

export const QUIET_DAYS = 2;
export const STALE_DAYS = 10;

export type DecayLevel = "fresh" | "quiet" | "stale";

export interface Decay {
  idleDays: number;
  level: DecayLevel;
}

/**
 * Idea decay (REQ-023): how long an idea has gone without activity, and how
 * worried to be about it. Fresh under 2 days, quiet from 2, stale from 10. Pure —
 * the board uses this to flag and sort languishing ideas (it does not change
 * state; an idea decays silently until someone votes or kills it).
 */
export function ideaDecay(lastActivityAt: Date, now: number = Date.now()): Decay {
  const idleDays = Math.max(0, Math.floor((now - lastActivityAt.getTime()) / DAY));
  const level: DecayLevel = idleDays >= STALE_DAYS ? "stale" : idleDays >= QUIET_DAYS ? "quiet" : "fresh";
  return { idleDays, level };
}
