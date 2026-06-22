import { asc, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { requirements, tasks, project } from "../db/schema";
import { emitEvent } from "../db/events";
import { renderSpec, type SpecRequirement, type SpecTaskRef } from "./render";
import { repoCommit } from "./commit";

export type SpecCommitFn = (content: string) => Promise<{ sha: string }>;

export interface MaterializeResult {
  requirementCount: number;
  sha: string;
}

/**
 * Materialize the spec (REQ-012): render the requirements table (+ linked tasks)
 * into SPEC.md, commit it to the repo, and emit spec.materialized. The commit is
 * injectable so the render is testable without a clone. When projectId is given
 * the spec is built from that project's requirements only; otherwise defaults to
 * the oldest project (same convention as listProjects).
 */
export async function materializeSpec(
  db: Db,
  commitOrProjectId?: SpecCommitFn | string,
  commitFn?: SpecCommitFn,
): Promise<MaterializeResult> {
  // Overload: materializeSpec(db, commit?) | materializeSpec(db, projectId, commit?)
  let resolvedProjectId: string | undefined;
  let commit: SpecCommitFn;

  if (typeof commitOrProjectId === "string") {
    resolvedProjectId = commitOrProjectId;
    commit = commitFn ?? ((content) => repoCommit(db, resolvedProjectId!, content));
  } else {
    commit = commitOrProjectId ?? ((content) => repoCommit(db, resolvedProjectId, content));
  }

  // Resolve project
  let proj: { id: string } | undefined;
  if (resolvedProjectId) {
    const [p] = await db.select({ id: project.id }).from(project).where(eq(project.id, resolvedProjectId)).limit(1);
    proj = p;
  } else {
    const [p] = await db.select({ id: project.id }).from(project).orderBy(asc(project.createdAt)).limit(1);
    proj = p;
  }
  if (!proj) throw new Error("No project bound (REQ-002).");
  const projectId = proj.id;

  const reqs: SpecRequirement[] = await db
    .select({
      key: requirements.key,
      title: requirements.title,
      description: requirements.description,
      status: requirements.status,
    })
    .from(requirements)
    .where(eq(requirements.projectId, projectId));
  const taskRefs: SpecTaskRef[] = await db
    .select({ key: tasks.key, title: tasks.title, requirementKey: requirements.key })
    .from(tasks)
    .innerJoin(requirements, eq(tasks.requirementId, requirements.id))
    .where(eq(requirements.projectId, projectId));

  const content = renderSpec(reqs, taskRefs);
  const { sha } = await commit(content);

  await db.transaction(async (tx) => {
    await emitEvent(tx, {
      type: "spec.materialized",
      subjectType: "project",
      payload: { count: reqs.length, commit_sha: sha },
      projectId,
    });
  });

  return { requirementCount: reqs.length, sha };
}
