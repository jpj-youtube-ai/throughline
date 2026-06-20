import { and, eq, desc } from "drizzle-orm";
import type { Db } from "../db/client";
import { ideas } from "../db/schema";
import { emitEvent } from "../db/events";

export interface ScratchIdea {
  id: string;
  title: string;
  why: string | null;
  createdAt: Date;
}

// An author's private scratch ideas — not yet open for voting (REQ-024).
export async function listScratchIdeas(db: Db, authorId: string): Promise<ScratchIdea[]> {
  return db
    .select({ id: ideas.id, title: ideas.title, why: ideas.why, createdAt: ideas.createdAt })
    .from(ideas)
    .where(and(eq(ideas.state, "scratch"), eq(ideas.authorId, authorId)))
    .orderBy(desc(ideas.createdAt));
}

export interface PromoteResult {
  promoted: boolean;
}

/**
 * Open a scratch idea for voting (REQ-024): scratch → voting, emitting
 * idea.graduated, in one transaction. Only the author can promote their own
 * scratch idea; promoting anything not in scratch is a no-op.
 */
export async function promoteIdea(db: Db, ideaId: string, userId: string): Promise<PromoteResult> {
  return db.transaction(async (tx) => {
    const [idea] = await tx
      .select({ state: ideas.state, authorId: ideas.authorId })
      .from(ideas)
      .where(eq(ideas.id, ideaId))
      .for("update")
      .limit(1);
    if (!idea) throw new Error("Idea not found.");
    if (idea.authorId !== userId) throw new Error("Only the author can open their scratch idea for voting.");
    if (idea.state !== "scratch") return { promoted: false };

    await tx
      .update(ideas)
      .set({ state: "voting", lastActivityAt: new Date(), updatedAt: new Date() })
      .where(eq(ideas.id, ideaId));
    await emitEvent(tx, {
      type: "idea.graduated",
      subjectType: "idea",
      subjectId: ideaId,
      actorId: userId,
      payload: { from: "scratch", to: "voting" },
    });
    return { promoted: true };
  });
}
