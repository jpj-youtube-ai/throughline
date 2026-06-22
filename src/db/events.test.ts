import test from "node:test";
import assert from "node:assert/strict";
import { sql, eq } from "drizzle-orm";
import { createTestDb } from "./client";
import { emitEvent } from "./events";
import { users, events, project } from "./schema";

// Drizzle wraps the database error as "Failed query: …" and puts the Postgres
// error (with our trigger's message) in `.cause`. Check the whole chain.
function mentionsAppendOnly(err: unknown): boolean {
  const cause = err instanceof Error ? (err.cause as unknown) : undefined;
  const text = `${err instanceof Error ? err.message : String(err)} ${
    cause instanceof Error ? cause.message : String(cause ?? "")
  }`;
  return /append-only/i.test(text);
}

async function seedProject(db: Awaited<ReturnType<typeof createTestDb>>["db"]): Promise<string> {
  const [p] = await db.insert(project).values({ repoFullName: "o/r", installationId: 1, defaultBranch: "main", localClonePath: "/t", specPath: "SPEC.md", claudeMdPath: "CLAUDE.md" }).returning({ id: project.id });
  return p.id;
}

test("emitEvent writes exactly one event row inside a transaction", async () => {
  const { db, close } = await createTestDb();
  try {
    const projectId = await seedProject(db);
    await db.transaction(async (tx) => {
      await emitEvent(tx, { type: "idea.voted", subjectType: "idea", payload: { voter: "u1" }, projectId });
    });
    const rows = await db.select().from(events);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].type, "idea.voted");
    assert.deepEqual(rows[0].payload, { voter: "u1" });
  } finally {
    await close();
  }
});

test("state write + event commit atomically; both roll back together on error", async () => {
  const { db, close } = await createTestDb();
  try {
    const projectId = await seedProject(db);
    // A failing transaction must persist neither the state row nor the event.
    await assert.rejects(
      db.transaction(async (tx) => {
        await tx.insert(users).values({ githubId: 1, githubLogin: "alice" });
        await emitEvent(tx, { type: "idea.voted", subjectType: "idea", projectId });
        throw new Error("boom");
      }),
    );
    assert.equal((await db.select().from(users)).length, 0, "user rolled back");
    assert.equal((await db.select().from(events)).length, 0, "event rolled back");

    // A committing transaction persists both, together.
    await db.transaction(async (tx) => {
      await tx.insert(users).values({ githubId: 2, githubLogin: "bob" });
      await emitEvent(tx, { type: "idea.voted", subjectType: "idea", projectId });
    });
    assert.equal((await db.select().from(users)).length, 1);
    assert.equal((await db.select().from(events)).length, 1);
  } finally {
    await close();
  }
});

test("rationale-required event without a rationale is rejected and not persisted", async () => {
  const { db, close } = await createTestDb();
  try {
    const projectId = await seedProject(db);
    await assert.rejects(
      db.transaction(async (tx) => {
        await emitEvent(tx, { type: "idea.submitted", subjectType: "idea", projectId });
      }),
      /requires a rationale/,
    );
    assert.equal((await db.select().from(events)).length, 0);
  } finally {
    await close();
  }
});

test("events is append-only: UPDATE and DELETE are rejected at the database", async () => {
  const { db, close } = await createTestDb();
  try {
    const projectId = await seedProject(db);
    await db.transaction(async (tx) => {
      await emitEvent(tx, { type: "idea.voted", subjectType: "idea", projectId });
    });
    await assert.rejects(db.execute(sql`update events set rationale = 'tamper'`), mentionsAppendOnly);
    await assert.rejects(db.execute(sql`delete from events`), mentionsAppendOnly);
    assert.equal((await db.select().from(events)).length, 1, "row left intact");
  } finally {
    await close();
  }
});

test("emitEvent writes project_id", async () => {
  const { db, close } = await createTestDb();
  try {
    const [p] = await db.insert(project).values({ repoFullName: "o/r", installationId: 1, defaultBranch: "main", localClonePath: "/t", specPath: "SPEC.md", claudeMdPath: "CLAUDE.md" }).returning({ id: project.id });
    let id = "";
    await db.transaction(async (tx) => { id = (await emitEvent(tx, { type: "project.bound", subjectType: "project", subjectId: p.id, projectId: p.id })).id; });
    const [e] = await db.select({ pid: events.projectId }).from(events).where(eq(events.id, id));
    assert.equal(e.pid, p.id);
  } finally { await close(); }
});
