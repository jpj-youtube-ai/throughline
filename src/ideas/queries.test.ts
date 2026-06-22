import test from "node:test";
import assert from "node:assert/strict";
import { createTestDb, type Db } from "../db/client";
import { users, ideas, votes, project } from "../db/schema";
import { listVotingIdeas } from "./queries";
import { listScratchIdeas } from "./scratch";

async function user(db: Db, githubId: number, login: string): Promise<string> {
  const [u] = await db.insert(users).values({ githubId, githubLogin: login }).returning({ id: users.id });
  return u.id;
}
async function idea(db: Db, title: string, authorId: string, state: "voting" | "approved", projectId: string): Promise<string> {
  const [i] = await db
    .insert(ideas)
    .values({ title, why: "w", authorId, state, projectId })
    .returning({ id: ideas.id });
  return i.id;
}

async function proj(db: Db, name: string): Promise<string> {
  const [p] = await db
    .insert(project)
    .values({ repoFullName: name, installationId: 1, defaultBranch: "main", localClonePath: "/t", specPath: "SPEC.md", claudeMdPath: "CLAUDE.md" })
    .returning({ id: project.id });
  return p.id;
}

test("idea board lists voting ideas with accurate vote counts, sorted by progress", async () => {
  const { db, close } = await createTestDb();
  try {
    const [proj] = await db
      .insert(project)
      .values({ repoFullName: "o/r", installationId: 1, defaultBranch: "main", localClonePath: "/t", specPath: "SPEC.md", claudeMdPath: "CLAUDE.md" })
      .returning({ id: project.id });
    const author = await user(db, 1, "alice");
    const v1 = await user(db, 2, "bob");
    const v2 = await user(db, 3, "carol");

    const a = await idea(db, "A", author, "voting", proj.id); // 2 votes
    const b = await idea(db, "B", author, "voting", proj.id); // 1 vote
    await idea(db, "C", author, "voting", proj.id); // 0 votes
    await idea(db, "D", author, "approved", proj.id); // excluded (not voting)

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

test("listVotingIdeas scopes to projectId when provided", async () => {
  const { db, close } = await createTestDb();
  try {
    const p1 = await proj(db, "org/alpha");
    const p2 = await proj(db, "org/beta");
    const author = await user(db, 10, "dev");

    await idea(db, "Alpha idea", author, "voting", p1);
    await idea(db, "Beta idea", author, "voting", p2);

    const forP1 = await listVotingIdeas(db, p1);
    assert.equal(forP1.length, 1);
    assert.equal(forP1[0].title, "Alpha idea");

    const forP2 = await listVotingIdeas(db, p2);
    assert.equal(forP2.length, 1);
    assert.equal(forP2[0].title, "Beta idea");
  } finally {
    await close();
  }
});

test("listScratchIdeas scopes to projectId when provided", async () => {
  const { db, close } = await createTestDb();
  try {
    const p1 = await proj(db, "org/alpha2");
    const p2 = await proj(db, "org/beta2");
    const author = await user(db, 11, "dev2");

    await db.insert(ideas).values({ title: "Scratch alpha", why: "w", authorId: author, state: "scratch", projectId: p1 });
    await db.insert(ideas).values({ title: "Scratch beta", why: "w", authorId: author, state: "scratch", projectId: p2 });

    const forP1 = await listScratchIdeas(db, p1, author);
    assert.equal(forP1.length, 1);
    assert.equal(forP1[0].title, "Scratch alpha");

    const forP2 = await listScratchIdeas(db, p2, author);
    assert.equal(forP2.length, 1);
    assert.equal(forP2[0].title, "Scratch beta");
  } finally {
    await close();
  }
});
