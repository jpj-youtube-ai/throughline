import test from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { createTestDb, type Db } from "../db/client";
import { users, ideas, events, project } from "../db/schema";
import { submitIdea } from "./submit";
import { listScratchIdeas, promoteIdea } from "./scratch";

async function seedUser(db: Db, login: string, githubId: number) {
  const [u] = await db.insert(users).values({ githubId, githubLogin: login }).returning({ id: users.id });
  return u.id;
}

async function seedProject(db: Db): Promise<string> {
  const [p] = await db
    .insert(project)
    .values({
      repoFullName: "acme/throughline",
      defaultBranch: "main",
      installationId: 42,
      localClonePath: "/tmp/repo",
      specPath: "SPEC.md",
      claudeMdPath: "CLAUDE.md",
    })
    .returning({ id: project.id });
  return p.id;
}

test("submitIdea can create a scratch idea (no voting until promoted)", async () => {
  const { db, close } = await createTestDb();
  try {
    await seedProject(db);
    const author = await seedUser(db, "alice", 1);
    const idea = await submitIdea(db, { title: "Rough thought", why: "might be worth it", authorId: author, state: "scratch" });

    assert.equal((await db.select().from(ideas).where(eq(ideas.id, idea.id)))[0].state, "scratch");
    const scratch = await listScratchIdeas(db, author);
    assert.deepEqual(scratch.map((s) => s.title), ["Rough thought"]);
  } finally {
    await close();
  }
});

test("scratch is author-scoped; promoteIdea opens it for voting and emits idea.graduated", async () => {
  const { db, close } = await createTestDb();
  try {
    await seedProject(db);
    const alice = await seedUser(db, "alice", 1);
    const bob = await seedUser(db, "bob", 2);
    const idea = await submitIdea(db, { title: "Mine", why: "w", authorId: alice, state: "scratch" });

    // only the author sees it in scratch
    assert.equal((await listScratchIdeas(db, bob)).length, 0);
    assert.equal((await listScratchIdeas(db, alice)).length, 1);

    // a non-author cannot promote it
    await assert.rejects(promoteIdea(db, idea.id, bob), /only the author/i);

    const res = await promoteIdea(db, idea.id, alice);
    assert.equal(res.promoted, true);
    assert.equal((await db.select().from(ideas).where(eq(ideas.id, idea.id)))[0].state, "voting");
    assert.equal((await listScratchIdeas(db, alice)).length, 0);

    const grad = await db.select().from(events).where(eq(events.type, "idea.graduated"));
    assert.equal(grad.length, 1);
    assert.deepEqual(grad[0].payload, { from: "scratch", to: "voting" });

    // promoting again is a no-op (already voting)
    assert.equal((await promoteIdea(db, idea.id, alice)).promoted, false);
  } finally {
    await close();
  }
});

test("promoteIdea carries projectId on the idea.graduated event", async () => {
  const { db, close } = await createTestDb();
  try {
    const projectId = await seedProject(db);
    const alice = await seedUser(db, "alice", 10);
    const idea = await submitIdea(db, { title: "Draft", why: "testing", authorId: alice, state: "scratch" });

    // Verify the idea itself got projectId from submitIdea.
    const [ideaRow] = await db.select().from(ideas).where(eq(ideas.id, idea.id));
    assert.equal(ideaRow.projectId, projectId, "scratch idea should carry projectId");

    await promoteIdea(db, idea.id, alice);

    const [grad] = await db.select().from(events).where(eq(events.type, "idea.graduated"));
    assert.equal(grad.projectId, projectId, "idea.graduated event should carry projectId");
  } finally {
    await close();
  }
});
