import { desc, eq, inArray } from "drizzle-orm";
import type { Db } from "../db/client";
import { events, users, tasks, requirements, ideas } from "../db/schema";

export type NodeKind = "merge" | "shipped" | "risk" | "default";

export interface ActivityItem {
  seq: number;
  type: string;
  actor: string | null; // github login, or null = system
  verb: string;
  subject: string | null;
  why: string | null;
  kind: NodeKind;
  createdAt: Date;
}

// type → human verb (+ node styling). The feed reads from the log, so this is
// the one place event types become English.
const VERB: Record<string, { verb: string; kind?: NodeKind }> = {
  "project.genesis_imported": { verb: "imported the genesis spec" },
  "project.bound": { verb: "bound the repository" },
  "requirement.declared": { verb: "declared" },
  "idea.submitted": { verb: "submitted" },
  "idea.graduated": { verb: "opened for voting" },
  "idea.voted": { verb: "voted on" },
  "idea.gate_passed": { verb: "carried to the gate" },
  "idea.approved": { verb: "approved" },
  "idea.rejected": { verb: "rejected" },
  "tasks.generated": { verb: "generated tasks for" },
  "task.claimed": { verb: "claimed" },
  "task.unclaimed": { verb: "released" },
  "drift.flagged": { verb: "flagged drift on", kind: "risk" },
  "drift.resolved": { verb: "resolved drift on" },
  "spec.materialized": { verb: "materialized the spec", kind: "shipped" },
  "claude_md.synced": { verb: "synced CLAUDE.md" },
};

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

export async function listActivity(db: Db, limit = 120): Promise<ActivityItem[]> {
  const rows = await db
    .select({
      seq: events.seq,
      type: events.type,
      subjectType: events.subjectType,
      subjectId: events.subjectId,
      payload: events.payload,
      rationale: events.rationale,
      createdAt: events.createdAt,
      actorLogin: users.githubLogin,
    })
    .from(events)
    .leftJoin(users, eq(events.actorId, users.id))
    .orderBy(desc(events.seq))
    .limit(limit);

  const idsByType = { task: [] as string[], requirement: [] as string[], idea: [] as string[] };
  for (const r of rows) {
    if (r.subjectId && r.subjectType in idsByType) idsByType[r.subjectType as keyof typeof idsByType].push(r.subjectId);
  }
  const taskKey = new Map<string, string>();
  const reqKey = new Map<string, string>();
  const ideaTitle = new Map<string, string>();
  if (idsByType.task.length)
    for (const t of await db.select({ id: tasks.id, key: tasks.key }).from(tasks).where(inArray(tasks.id, idsByType.task)))
      taskKey.set(t.id, t.key);
  if (idsByType.requirement.length)
    for (const t of await db
      .select({ id: requirements.id, key: requirements.key })
      .from(requirements)
      .where(inArray(requirements.id, idsByType.requirement)))
      reqKey.set(t.id, t.key);
  if (idsByType.idea.length)
    for (const t of await db.select({ id: ideas.id, title: ideas.title }).from(ideas).where(inArray(ideas.id, idsByType.idea)))
      ideaTitle.set(t.id, t.title);

  return rows.map((r) => {
    const def = VERB[r.type] ?? { verb: r.type.replace(/[._]/g, " ") };
    let verb = def.verb;
    let kind: NodeKind = def.kind ?? "default";

    let subject: string | null = null;
    if (r.subjectId && r.subjectType === "task") subject = taskKey.get(r.subjectId) ?? null;
    else if (r.subjectId && r.subjectType === "requirement")
      subject = reqKey.get(r.subjectId) ?? ((r.payload?.key as string | undefined) ?? null);
    else if (r.subjectId && r.subjectType === "idea") {
      const t = ideaTitle.get(r.subjectId);
      subject = t ? `“${truncate(t, 46)}”` : null;
    }

    if (r.type === "task.github_status_changed") {
      const to = String(r.payload?.to ?? "");
      verb = to === "closed" ? "merged / closed" : to === "open" ? "reopened" : "status changed on";
      kind = to === "closed" ? "merge" : "default";
    }

    if (r.type === "work.logged_retroactively") {
      const tk = r.payload?.task_key as string | undefined;
      verb = tk ? `logged past work on ${tk}` : "logged past work";
      const summary = r.payload?.summary as string | undefined;
      subject = summary ? `“${truncate(summary, 46)}”` : null;
    }

    return {
      seq: Number(r.seq),
      type: r.type,
      actor: r.actorLogin ?? null,
      verb,
      subject,
      why: r.rationale ?? null,
      kind,
      createdAt: r.createdAt,
    };
  });
}
