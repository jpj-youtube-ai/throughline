// src/requirements/declare.ts
import { asc } from "drizzle-orm";
import type { Db } from "../db/client";
import { requirements, project } from "../db/schema";
import { emitEvent } from "../db/events";
import { nextRequirementKey } from "./keys";

export type Provenance = "imported" | "voted" | "drift";

export interface DeclareRequirementInput {
  title: string;
  description?: string;
  provenance: Provenance;
  why?: string | null; // recorded as the requirement.declared rationale
  actorId?: string | null;
  originIdeaId?: string | null;
  projectId?: string | null; // if omitted, resolved from the oldest project inside the tx
}

/**
 * Declare a new requirement: mint the next monotonic REQ-NNN, insert the row
 * (status=planned), and emit requirement.declared — all in one transaction.
 * The key is max(existing number)+1 so gaps never collide.
 *
 * If projectId is not provided, the oldest project is resolved inside the
 * transaction so existing callers (genesis, drift) keep working until later
 * tasks pass it explicitly.
 */
export async function declareRequirement(db: Db, input: DeclareRequirementInput): Promise<{ id: string; key: string }> {
  return db.transaction(async (tx) => {
    // Resolve projectId inside the transaction so it's consistent with the insert.
    let projectId: string | null = input.projectId ?? null;
    if (!projectId) {
      const [p] = await tx
        .select({ id: project.id })
        .from(project)
        .orderBy(asc(project.createdAt))
        .limit(1);
      projectId = p?.id ?? null;
    }

    const key = await nextRequirementKey(tx, projectId);
    const [row] = await tx
      .insert(requirements)
      .values({
        key,
        title: input.title,
        description: input.description ?? "",
        status: "planned",
        provenance: input.provenance,
        originIdeaId: input.originIdeaId ?? null,
        projectId,
      })
      .returning({ id: requirements.id });
    await emitEvent(tx, {
      type: "requirement.declared",
      subjectType: "requirement",
      subjectId: row.id,
      actorId: input.actorId ?? null,
      payload: { provenance: input.provenance, key, origin_idea_id: input.originIdeaId ?? null },
      rationale: input.why ?? null,
      projectId: projectId ?? undefined,
    });
    return { id: row.id, key };
  });
}
