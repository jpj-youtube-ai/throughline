import { and, inArray, eq, asc } from "drizzle-orm";
import type { Db } from "../db/client";
import { ideas, tasks } from "../db/schema";

export interface PipelineItem {
  label: string;
  href: string;
}

export interface PipelineStage {
  key: string;
  label: string;
  hint: string;
  count: number;
  items: PipelineItem[];
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

/**
 * The lifecycle pipeline (REQ-021): where everything is right now, as an idea
 * becomes merged work. Read-only over the board DB — ideas in voting/approved,
 * then tasks by claim + mirrored github status.
 */
export async function listPipeline(db: Db, projectId?: string): Promise<PipelineStage[]> {
  const ideaRows = await db
    .select({ title: ideas.title, state: ideas.state })
    .from(ideas)
    .where(
      projectId
        ? and(inArray(ideas.state, ["voting", "approved"]), eq(ideas.projectId, projectId))
        : inArray(ideas.state, ["voting", "approved"]),
    )
    .orderBy(asc(ideas.title));
  const taskRows = await db
    .select({ key: tasks.key, claimState: tasks.claimState, githubStatus: tasks.githubStatus })
    .from(tasks)
    .where(projectId ? eq(tasks.projectId, projectId) : undefined)
    .orderBy(asc(tasks.key));

  const ideaItem = (title: string): PipelineItem => ({ label: truncate(title, 36), href: "/ideas" });
  const taskItem = (key: string): PipelineItem => ({ label: key, href: "/tasks" });

  const voting = ideaRows.filter((i) => i.state === "voting").map((i) => ideaItem(i.title));
  const approved = ideaRows.filter((i) => i.state === "approved").map((i) => ideaItem(i.title));
  const open = taskRows
    .filter((t) => t.githubStatus === "open" && t.claimState === "unclaimed")
    .map((t) => taskItem(t.key));
  const claimed = taskRows
    .filter((t) => t.githubStatus === "open" && t.claimState === "claimed")
    .map((t) => taskItem(t.key));
  const merged = taskRows.filter((t) => t.githubStatus === "closed").map((t) => taskItem(t.key));

  return [
    { key: "voting", label: "Voting", hint: "ideas gathering approvals", count: voting.length, items: voting },
    { key: "approved", label: "Approved", hint: "awaiting generation", count: approved.length, items: approved },
    { key: "open", label: "Open", hint: "tasks unclaimed", count: open.length, items: open },
    { key: "claimed", label: "Claimed", hint: "in progress", count: claimed.length, items: claimed },
    { key: "merged", label: "Merged", hint: "done", count: merged.length, items: merged },
  ];
}
