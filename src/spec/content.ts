import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { requirements, tasks } from "../db/schema";
import { renderSpec, type SpecRequirement, type SpecTaskRef } from "./render";

/**
 * Build the materialized SPEC.md content for a project from its requirements +
 * linked tasks (REQ-012/017). The DB requirements are the source of truth; this
 * renders the projection. Read-only. Returns the markdown and the requirement
 * count (for the empty-state check and the materialize event payload).
 */
export async function buildSpecContent(
  db: Db,
  projectId: string,
): Promise<{ content: string; requirementCount: number }> {
  const reqs: SpecRequirement[] = await db
    .select({ key: requirements.key, title: requirements.title, description: requirements.description, status: requirements.status })
    .from(requirements)
    .where(eq(requirements.projectId, projectId));
  const taskRefs: SpecTaskRef[] = await db
    .select({ key: tasks.key, title: tasks.title, requirementKey: requirements.key })
    .from(tasks)
    .innerJoin(requirements, eq(tasks.requirementId, requirements.id))
    .where(eq(requirements.projectId, projectId));
  return { content: renderSpec(reqs, taskRefs), requirementCount: reqs.length };
}
