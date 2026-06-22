import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { requirements } from "../db/schema";
import { emitEvent } from "../db/events";

export interface AmendRequirementInput {
  key: string; // REQ-NNN to amend
  title?: string; // optional new title; omit to keep the current one
  description: string; // replaces the current description
  why: string; // rationale — requirement.amended must carry a why
  actorId?: string | null;
}

/**
 * Amend an existing requirement's definition (title/description) and record it
 * with requirement.amended + a rationale, in one transaction. The only sanctioned
 * way to change a requirement's text: declare creates, lifecycle changes status,
 * amend redefines. Does not touch status (that stays lifecycle-derived). Throws
 * if the key does not exist.
 */
export async function amendRequirement(db: Db, input: AmendRequirementInput): Promise<{ id: string; key: string }> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ id: requirements.id, title: requirements.title, description: requirements.description, projectId: requirements.projectId })
      .from(requirements)
      .where(eq(requirements.key, input.key))
      .for("update")
      .limit(1);
    if (!row) throw new Error(`Cannot amend ${input.key}: no such requirement.`);

    const nextTitle = input.title ?? row.title;
    await tx
      .update(requirements)
      .set({ title: nextTitle, description: input.description, updatedAt: new Date() })
      .where(eq(requirements.id, row.id));

    await emitEvent(tx, {
      type: "requirement.amended",
      subjectType: "requirement",
      subjectId: row.id,
      actorId: input.actorId ?? null,
      payload: {
        key: input.key,
        from: { title: row.title, description: row.description },
        to: { title: nextTitle, description: input.description },
      },
      rationale: input.why,
      projectId: row.projectId ?? undefined,
    });
    return { id: row.id, key: input.key };
  });
}
