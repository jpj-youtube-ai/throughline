import { eq, desc, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { ideas, users, votes } from "../db/schema";

export interface VotingIdea {
  id: string;
  title: string;
  why: string | null;
  feasibility: number | null;
  viability: number | null;
  authorLogin: string;
  voteCount: number; // distinct approval votes so far (progress toward the gate)
  createdAt: Date;
  lastActivityAt: Date; // for decay (REQ-023)
}

/**
 * The idea board (REQ-006): ideas in voting with title, why, scores, author, and
 * live vote progress, default-sorted by vote progress (closest to the gate first).
 */
export async function listVotingIdeas(db: Db): Promise<VotingIdea[]> {
  return db
    .select({
      id: ideas.id,
      title: ideas.title,
      why: ideas.why,
      feasibility: ideas.feasibility,
      viability: ideas.viability,
      authorLogin: users.githubLogin,
      voteCount: sql<number>`cast(count(${votes.id}) as integer)`,
      createdAt: ideas.createdAt,
      lastActivityAt: ideas.lastActivityAt,
    })
    .from(ideas)
    .innerJoin(users, eq(ideas.authorId, users.id))
    .leftJoin(votes, eq(votes.ideaId, ideas.id))
    .where(eq(ideas.state, "voting"))
    .groupBy(ideas.id, users.githubLogin)
    .orderBy(desc(sql`count(${votes.id})`), desc(ideas.createdAt));
}

// Idea ids the given user has already voted on (to mark/disable the vote button).
export async function idsUserVotedFor(db: Db, userId: string): Promise<string[]> {
  const rows = await db.select({ ideaId: votes.ideaId }).from(votes).where(eq(votes.userId, userId));
  return rows.map((r) => r.ideaId);
}
