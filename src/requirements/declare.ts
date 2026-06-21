// src/requirements/declare.ts
import type { Db } from "../db/client";
import { requirements } from "../db/schema";
import { emitEvent } from "../db/events";

export type Provenance = "imported" | "voted" | "drift";

export interface DeclareRequirementInput {
  title: string;
  description?: string;
  provenance: Provenance;
  why?: string | null; // recorded as the requirement.declared rationale
  actorId?: string | null;
  originIdeaId?: string | null;
}

/**
 * Declare a new requirement: mint the next monotonic REQ-NNN, insert the row
 * (status=planned), and emit requirement.declared — all in one transaction.
 * The key is max(existing number)+1 so gaps never collide.
 */
export async function declareRequirement(db: Db, input: DeclareRequirementInput): Promise<{ id: string; key: string }> {
  return db.transaction(async (tx) => {
    const existing = await tx.select({ key: requirements.key }).from(requirements);
    let max = 0;
    for (const r of existing) {
      const m = /-(\d+)$/.exec(r.key);
      if (m) max = Math.max(max, Number(m[1]));
    }
    const key = `REQ-${String(max + 1).padStart(3, "0")}`;
    const [row] = await tx
      .insert(requirements)
      .values({
        key,
        title: input.title,
        description: input.description ?? "",
        status: "planned",
        provenance: input.provenance,
        originIdeaId: input.originIdeaId ?? null,
      })
      .returning({ id: requirements.id });
    await emitEvent(tx, {
      type: "requirement.declared",
      subjectType: "requirement",
      subjectId: row.id,
      actorId: input.actorId ?? null,
      payload: { provenance: input.provenance, key, origin_idea_id: input.originIdeaId ?? null },
      rationale: input.why ?? null,
    });
    return { id: row.id, key };
  });
}
