import test from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { createTestDb, type Db } from "../db/client";
import { users, requirements, tasks, events, project } from "../db/schema";
import { logWorkRetroactively } from "./retroactive";

async function seed(db: Db) {
  const [p] = await db
    .insert(project)
    .values({ repoFullName: "o/r", installationId: 1, defaultBranch: "main", localClonePath: "/t", specPath: "SPEC.md", claudeMdPath: "CLAUDE.md" })
    .returning({ id: project.id });
  const [u] = await db.insert(users).values({ githubId: 1, githubLogin: "alice" }).returning({ id: users.id });
  const [r] = await db
    .insert(requirements)
    .values({ key: "REQ-003", title: "Event log", description: "d", provenance: "imported", projectId: p.id })
    .returning({ id: requirements.id });
  const [t] = await db
    .insert(tasks)
    .values({ key: "TASK-014", title: "t", body: "b", requirementId: r.id, effort: 1, risk: "low", confidence: 50, projectId: p.id })
    .returning({ id: tasks.id });
  return { userId: u.id, taskId: t.id };
}

test("logWorkRetroactively records the event with the why and an optional task link", async () => {
  const { db, close } = await createTestDb();
  try {
    const { userId, taskId } = await seed(db);

    // standalone (no task)
    await logWorkRetroactively(db, { summary: "Migrated prod by hand", rationale: "outage, no time for the flow", actorId: userId });
    // attached to a task (case-insensitive key)
    await logWorkRetroactively(db, { summary: "Fixed the flaky test", rationale: "found while reviewing", actorId: userId, taskKey: "task-014" });

    const evs = await db.select().from(events).where(eq(events.type, "work.logged_retroactively"));
    assert.equal(evs.length, 2);

    const standalone = evs.find((e) => e.subjectType === "project")!;
    assert.equal(standalone.subjectId, null);
    assert.match(standalone.rationale ?? "", /outage/);
    assert.equal((standalone.payload as { summary: string }).summary, "Migrated prod by hand");

    const attached = evs.find((e) => e.subjectType === "task")!;
    assert.equal(attached.subjectId, taskId);
    assert.equal((attached.payload as { task_key: string }).task_key, "TASK-014");
  } finally {
    await close();
  }
});

test("logWorkRetroactively requires a summary and a why, and a real task key", async () => {
  const { db, close } = await createTestDb();
  try {
    const { userId } = await seed(db);
    await assert.rejects(logWorkRetroactively(db, { summary: "  ", rationale: "w", actorId: userId }), /what was done/i);
    await assert.rejects(logWorkRetroactively(db, { summary: "did a thing", rationale: " ", actorId: userId }), /why/i);
    await assert.rejects(
      logWorkRetroactively(db, { summary: "x", rationale: "y", actorId: userId, taskKey: "TASK-999" }),
      /No task TASK-999/i,
    );
  } finally {
    await close();
  }
});
