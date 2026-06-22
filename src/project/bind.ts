import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { project } from "../db/schema";
import { emitEvent } from "../db/events";

export interface BindProjectInput {
  repoFullName: string;
  installationId: number;
  defaultBranch: string;
  localClonePath: string;
  actorId?: string | null; // the operator who binds
}

export interface BoundProject {
  id: string;
  repoFullName: string;
}

/**
 * Bind a GitHub repo as a project (REQ-002, REQ-029): insert a `project` row
 * and emit project.bound, in one transaction. Each repo may only be bound once;
 * binding a different repo is supported (multi-project). Binding is a project
 * decision, so it is logged (the "repo bound" milestone in REQ-022 derives from
 * this event).
 */
export async function bindProject(db: Db, input: BindProjectInput): Promise<BoundProject> {
  return db.transaction(async (tx) => {
    const dup = await tx
      .select({ id: project.id })
      .from(project)
      .where(eq(project.repoFullName, input.repoFullName))
      .limit(1);
    if (dup.length > 0) {
      throw new Error(`A project is already bound to ${input.repoFullName}.`);
    }

    const [row] = await tx
      .insert(project)
      .values({
        repoFullName: input.repoFullName,
        installationId: input.installationId,
        defaultBranch: input.defaultBranch,
        localClonePath: input.localClonePath,
      })
      .returning({ id: project.id, repoFullName: project.repoFullName });

    await emitEvent(tx, {
      type: "project.bound",
      subjectType: "project",
      subjectId: row.id,
      actorId: input.actorId ?? null,
      payload: {
        repo_full_name: input.repoFullName,
        installation_id: input.installationId,
        default_branch: input.defaultBranch,
      },
      projectId: row.id,
    });

    return row;
  });
}
