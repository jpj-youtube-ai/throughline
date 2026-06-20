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
 * Bind the project to one GitHub repo (REQ-002): create the `project` singleton
 * and emit project.bound, in one transaction. Single project / single repo —
 * a second bind is refused. Binding is a project decision, so it is logged
 * (the "repo bound" milestone in REQ-022 derives from this event).
 */
export async function bindProject(db: Db, input: BindProjectInput): Promise<BoundProject> {
  return db.transaction(async (tx) => {
    const existing = await tx
      .select({ id: project.id, repoFullName: project.repoFullName })
      .from(project)
      .limit(1);
    if (existing.length > 0) {
      throw new Error(
        `Project already bound to ${existing[0].repoFullName}; rebinding is not supported (single project / single repo).`,
      );
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
    });

    return row;
  });
}
