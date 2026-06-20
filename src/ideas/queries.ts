import { eq, desc } from "drizzle-orm";
import type { Db } from "../db/client";
import { ideas, users } from "../db/schema";

export interface VotingIdea {
  id: string;
  title: string;
  why: string | null;
  feasibility: number | null;
  viability: number | null;
  authorLogin: string;
  createdAt: Date;
}

// Lists ideas currently in voting (REQ-006 enriches this with vote progress and
// progress-based sorting). For now: newest first.
export async function listVotingIdeas(db: Db): Promise<VotingIdea[]> {
  return db
    .select({
      id: ideas.id,
      title: ideas.title,
      why: ideas.why,
      feasibility: ideas.feasibility,
      viability: ideas.viability,
      authorLogin: users.githubLogin,
      createdAt: ideas.createdAt,
    })
    .from(ideas)
    .innerJoin(users, eq(ideas.authorId, users.id))
    .where(eq(ideas.state, "voting"))
    .orderBy(desc(ideas.createdAt));
}
