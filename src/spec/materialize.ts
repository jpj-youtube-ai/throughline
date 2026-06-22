import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { requirements, tasks } from "../db/schema";
import { emitEvent } from "../db/events";
import { getActiveProjectId } from "../project/active";
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
 * injectable so the render is testable without a clone.
 */
export async function materializeSpec(
  db: Db,
  commit: SpecCommitFn = (content) => repoCommit(db, content),
): Promise<MaterializeResult> {
  const reqs: SpecRequirement[] = await db
    .select({
      key: requirements.key,
      title: requirements.title,
      description: requirements.description,
      status: requirements.status,
    })
    .from(requirements);
  const taskRefs: SpecTaskRef[] = await db
    .select({ key: tasks.key, title: tasks.title, requirementKey: requirements.key })
    .from(tasks)
    .innerJoin(requirements, eq(tasks.requirementId, requirements.id));

  const content = renderSpec(reqs, taskRefs);
  const { sha } = await commit(content);

  const projectId = await getActiveProjectId(db, null).catch(() => undefined);

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
