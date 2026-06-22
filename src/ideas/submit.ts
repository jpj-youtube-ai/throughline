import type { Db } from "../db/client";
import { ideas } from "../db/schema";
import { emitEvent } from "../db/events";
import { getActiveProjectId } from "../project/active";

export interface SubmitIdeaInput {
  title: string;
  why: string; // mandatory pitch
  feasibility?: number | null; // 1-10
  viability?: number | null; // 1-10
  authorId: string; // users.id
  state?: "scratch" | "voting"; // scratch = private holding area (REQ-024); default voting
}

export interface SubmittedIdea {
  id: string;
  title: string;
}

function inRange(label: string, v: number | null | undefined): void {
  if (v == null) return;
  if (!Number.isInteger(v) || v < 1 || v > 10) {
    throw new Error(`${label} must be an integer from 1 to 10.`);
  }
}

/**
 * Submit an idea (REQ-005): create the idea and emit idea.submitted with the why
 * as rationale, in one transaction. The why is mandatory — empty why blocks
 * submission (also enforced by emitEvent's rationale requirement). Created in
 * `voting` by default, or `scratch` (a private holding area, REQ-024) — promote
 * scratch → voting later with promoteIdea.
 */
export async function submitIdea(db: Db, input: SubmitIdeaInput): Promise<SubmittedIdea> {
  const title = input.title.trim();
  const why = input.why?.trim() ?? "";
  if (!title) throw new Error("An idea needs a title.");
  if (!why) throw new Error("An idea needs a why (the pitch).");
  inRange("feasibility", input.feasibility);
  inRange("viability", input.viability);
  const state = input.state ?? "voting";
  const projectId = await getActiveProjectId(db, input.authorId);

  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(ideas)
      .values({
        title,
        why,
        feasibility: input.feasibility ?? null,
        viability: input.viability ?? null,
        authorId: input.authorId,
        state,
        projectId,
      })
      .returning({ id: ideas.id, title: ideas.title });

    await emitEvent(tx, {
      type: "idea.submitted",
      subjectType: "idea",
      subjectId: row.id,
      actorId: input.authorId,
      payload: {
        author: input.authorId,
        state,
        scores: { feasibility: input.feasibility ?? null, viability: input.viability ?? null },
      },
      rationale: why,
      projectId,
    });

    return row;
  });
}
