import { asc } from "drizzle-orm";
import type { Db } from "../db/client";
import { requirements, tasks } from "../db/schema";

export interface SpecMapTask {
  key: string;
  githubStatus: "open" | "closed";
  claimState: "unclaimed" | "claimed";
}

export interface SpecMapRequirement {
  key: string;
  title: string;
  description: string;
  status: "planned" | "building" | "shipped";
  provenance: "imported" | "voted" | "drift";
  tasks: SpecMapTask[];
}

// The spec map (REQ-017): every requirement with its provenance and the tasks
// that implement it. Read-only over the board DB; the page groups by status.
export async function listSpecMap(db: Db): Promise<SpecMapRequirement[]> {
  const reqRows = await db
    .select({
      id: requirements.id,
      key: requirements.key,
      title: requirements.title,
      description: requirements.description,
      status: requirements.status,
      provenance: requirements.provenance,
    })
    .from(requirements)
    .orderBy(asc(requirements.key));

  const taskRows = await db
    .select({
      requirementId: tasks.requirementId,
      key: tasks.key,
      githubStatus: tasks.githubStatus,
      claimState: tasks.claimState,
    })
    .from(tasks)
    .orderBy(asc(tasks.key));

  const byReq = new Map<string, SpecMapTask[]>();
  for (const t of taskRows) {
    const list = byReq.get(t.requirementId) ?? [];
    list.push({ key: t.key, githubStatus: t.githubStatus, claimState: t.claimState });
    byReq.set(t.requirementId, list);
  }

  return reqRows.map((r) => ({
    key: r.key,
    title: r.title,
    description: r.description,
    status: r.status,
    provenance: r.provenance,
    tasks: byReq.get(r.id) ?? [],
  }));
}
