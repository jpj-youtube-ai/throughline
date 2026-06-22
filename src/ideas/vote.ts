import { eq, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { ideas, votes } from "../db/schema";
import { emitEvent } from "../db/events";
import { APPROVAL_GATE } from "./gate";

export interface CastVoteResult {
  voted: boolean; // false = the user had already voted (idempotent no-op)
  voteCount: number;
  approvedNow: boolean; // true if THIS vote crossed the gate
  state: "scratch" | "voting" | "approved" | "rejected" | "generated";
}

/**
 * Cast an approval vote (REQ-007). One vote per user per idea (unique); the
 * author may vote. The 2nd distinct vote crosses the gate: the idea flips to
 * `approved`, emitting idea.voted → idea.gate_passed → idea.approved, all in one
 * transaction. Further votes record idea.voted but have no gate effect.
 */
export async function castVote(db: Db, ideaId: string, userId: string): Promise<CastVoteResult> {
  return db.transaction(async (tx) => {
    // Lock the idea row so concurrent votes can't both trip the gate.
    const [idea] = await tx
      .select({ state: ideas.state, projectId: ideas.projectId })
      .from(ideas)
      .where(eq(ideas.id, ideaId))
      .for("update")
      .limit(1);
    if (!idea) throw new Error("Idea not found.");

    const inserted = await tx
      .insert(votes)
      .values({ ideaId, userId })
      .onConflictDoNothing()
      .returning({ id: votes.id });

    const [{ c: voteCount }] = await tx
      .select({ c: sql<number>`cast(count(*) as integer)` })
      .from(votes)
      .where(eq(votes.ideaId, ideaId));

    if (inserted.length === 0) {
      // Already voted — no event, no gate effect.
      return { voted: false, voteCount, approvedNow: false, state: idea.state };
    }

    const projectId = idea.projectId ?? undefined;
    await emitEvent(tx, {
      type: "idea.voted",
      subjectType: "idea",
      subjectId: ideaId,
      actorId: userId,
      payload: { voter: userId },
      projectId,
    });

    let approvedNow = false;
    let state = idea.state;
    if (idea.state === "voting" && voteCount >= APPROVAL_GATE) {
      await tx.update(ideas).set({ state: "approved", updatedAt: new Date() }).where(eq(ideas.id, ideaId));
      await emitEvent(tx, {
        type: "idea.gate_passed",
        subjectType: "idea",
        subjectId: ideaId,
        payload: { count: voteCount },
        projectId,
      });
      await emitEvent(tx, {
        type: "idea.approved",
        subjectType: "idea",
        subjectId: ideaId,
        // Gate-driven approval — a system decision, with the gate as the recorded why.
        rationale: `Reached the ${APPROVAL_GATE}-approval gate.`,
        projectId,
      });
      approvedNow = true;
      state = "approved";
    }

    return { voted: true, voteCount, approvedNow, state };
  });
}
