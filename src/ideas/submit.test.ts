import test from "node:test";
import assert from "node:assert/strict";
import { createTestDb, type Db } from "../db/client";
import { users, ideas, events, project } from "../db/schema";
import { submitIdea } from "./submit";

async function makeUser(db: Db): Promise<string> {
  const [u] = await db
    .insert(users)
    .values({ githubId: 1, githubLogin: "alice" })
    .returning({ id: users.id });
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

test("submitIdea creates a voting idea and emits idea.submitted with the why as rationale", async () => {
  const { db, close } = await createTestDb();
  try {
    await seedProject(db);
    const authorId = await makeUser(db);
    const idea = await submitIdea(db, {
      title: "Event log foundation",
      why: "correctness depends on a causal record",
      feasibility: 8,
      viability: 9,
      authorId,
    });

    const rows = await db.select().from(ideas);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].state, "voting");
    assert.equal(rows[0].why, "correctness depends on a causal record");
    assert.equal(rows[0].feasibility, 8);

    const evs = await db.select().from(events);
    assert.equal(evs.length, 1);
    assert.equal(evs[0].type, "idea.submitted");
    assert.equal(evs[0].subjectId, idea.id);
    assert.equal(evs[0].rationale, "correctness depends on a causal record");
  } finally {
    await close();
  }
});

test("submitIdea rejects an empty why and persists nothing", async () => {
  const { db, close } = await createTestDb();
  try {
    await seedProject(db);
    const authorId = await makeUser(db);
    await assert.rejects(submitIdea(db, { title: "X", why: "   ", authorId }), /why/i);
    assert.equal((await db.select().from(ideas)).length, 0);
    assert.equal((await db.select().from(events)).length, 0);
  } finally {
    await close();
  }
});

test("submitIdea sets projectId on the idea row and the event", async () => {
  const { db, close } = await createTestDb();
  try {
    const projectId = await seedProject(db);
    const authorId = await makeUser(db);
    const idea = await submitIdea(db, {
      title: "Scoped idea",
      why: "to verify project threading",
      authorId,
    });

    const [row] = await db.select().from(ideas);
    assert.equal(row.projectId, projectId, "idea.project_id should match the seeded project");

    const [ev] = await db.select().from(events);
    assert.equal(ev.projectId, projectId, "event.project_id should match the seeded project");
    assert.equal(ev.subjectId, idea.id);
  } finally {
    await close();
  }
});

test("submitIdea rejects an empty title and an out-of-range score", async () => {
  const { db, close } = await createTestDb();
  try {
    await seedProject(db);
    const authorId = await makeUser(db);
    await assert.rejects(submitIdea(db, { title: "   ", why: "real why", authorId }), /title/i);
    await assert.rejects(
      submitIdea(db, { title: "T", why: "real why", feasibility: 11, authorId }),
      /feasibility/i,
    );
    assert.equal((await db.select().from(ideas)).length, 0);
  } finally {
    await close();
  }
});
