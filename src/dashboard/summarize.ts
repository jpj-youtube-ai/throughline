import type { ActivityItem } from "../events/feed";
import type { TaskListItem } from "../tasks/queries";
import type { SpecMapRequirement } from "../spec/map";
import type { VotingIdea } from "../ideas/queries";

export function eventsSince(items: ActivityItem[], sinceMs: number): number {
  return items.filter((it) => it.createdAt.getTime() >= sinceMs).length;
}

export interface TaskBreakdown {
  open: number;
  claimed: number;
  merged: number;
}

export function taskBreakdown(tasks: TaskListItem[]): TaskBreakdown {
  let open = 0;
  let claimed = 0;
  let merged = 0;
  for (const t of tasks) {
    if (t.githubStatus === "closed") merged++;
    else if (t.claimState === "claimed") claimed++;
    else open++;
  }
  return { open, claimed, merged };
}

// claimed-and-open first (rank 0), then unclaimed-open (1), then merged (2);
// within a rank, newest key first.
export function topTasks(tasks: TaskListItem[], n: number): TaskListItem[] {
  const rank = (t: TaskListItem): number =>
    t.githubStatus === "closed" ? 2 : t.claimState === "claimed" ? 0 : 1;
  return [...tasks].sort((a, b) => rank(a) - rank(b) || b.key.localeCompare(a.key)).slice(0, n);
}

export interface ReqBreakdown {
  planned: number;
  building: number;
  shipped: number;
}

export function reqBreakdown(reqs: SpecMapRequirement[]): ReqBreakdown {
  let planned = 0;
  let building = 0;
  let shipped = 0;
  for (const r of reqs) {
    if (r.status === "shipped") shipped++;
    else if (r.status === "building") building++;
    else planned++;
  }
  return { planned, building, shipped };
}

export function pct(done: number, scope: number): number {
  return scope === 0 ? 0 : Math.round((100 * done) / scope);
}

// Ideas the current viewer has not yet voted on (drives the "needs votes" badge).
export function ideasAwaitingVote(ideas: VotingIdea[], votedIds: string[]): VotingIdea[] {
  const voted = new Set(votedIds);
  return ideas.filter((i) => !voted.has(i.id));
}
