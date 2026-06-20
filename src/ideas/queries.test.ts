import test from "node:test";
import assert from "node:assert/strict";
import { createTestDb, type Db } from "../db/client";
import { users, ideas, votes } from "../db/schema";
import { listVotingIdeas } from "./queries";

async function user(db: Db, githubId: number, login: string): Promise<string> {
  const [u] = await db.insert(users).values({ githubId, githubLogin: login }).returning({ id: users.id });
  return u.id;
}
async function idea(db: Db, title: string, authorId: string, state: "voting" | "approved"): Promise<string> {
  const [i] = await db
    .insert(ideas)
    .values({ title, why: "w", authorId, state })
    .returning({ id: ideas.id });
  return i.id;
}

test("idea board lists voting ideas with accurate vote counts, sorted by progress", async () => {
  const { db, close } = await createTestDb();
  try {
    const author = await user(db, 1, "alice");
    const v1 = await user(db, 2, "bob");
    const v2 = await user(db, 3, "carol");

    const a = await idea(db, "A", author, "voting"); // 2 votes
    const b = await idea(db, "B", author, "voting"); // 1 vote
    await idea(db, "C", author, "voting"); // 0 votes
    await idea(db, "D", author, "approved"); // excluded (not voting)

    await db.insert(votes).values([
      { ideaId: a, userId: v1 },
      { ideaId: a, userId: v2 },
      { ideaId: b, userId: v1 },
    ]);

    const list = await listVotingIdeas(db);
    assert.equal(list.length, 3, "approved idea excluded");
    assert.deepEqual(
      list.map((i) => i.title),
      ["A", "B", "C"],
      "sorted by vote progress, most first",
    );
    const counts = Object.fromEntries(list.map((i) => [i.title, i.voteCount]));
    assert.equal(counts.A, 2);
    assert.equal(counts.B, 1);
    assert.equal(counts.C, 0);
    assert.equal(typeof counts.A, "number", "voteCount comes back as a number");
  } finally {
    await close();
  }
});
