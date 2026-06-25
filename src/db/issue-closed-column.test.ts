import test from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { createTestDb } from "./client";
import { project, requirements, tasks } from "./schema";

test("tasks.issue_closed_at defaults to null and round-trips a timestamp", async () => {
  const { db, close } = await createTestDb();
  try {
    const [p] = await db
      .insert(project)
      .values({ repoFullName: "a/b", installationId: 1, defaultBranch: "main", localClonePath: "/x" })
      .returning({ id: project.id });
    const [r] = await db
      .insert(requirements)
      .values({ key: "REQ-001", title: "t", description: "d", provenance: "imported", projectId: p.id })
      .returning({ id: requirements.id });
    const [t] = await db
      .insert(tasks)
      .values({ key: "TASK-001", title: "t", body: "b", requirementId: r.id, effort: 1, risk: "low", confidence: 50, projectId: p.id })
      .returning({ id: tasks.id });

    const [fresh] = await db.select({ at: tasks.issueClosedAt }).from(tasks).where(eq(tasks.id, t.id));
    assert.equal(fresh.at, null, "defaults to null");

    const when = new Date("2026-06-25T12:00:00.000Z");
    await db.update(tasks).set({ issueClosedAt: when }).where(eq(tasks.id, t.id));
    const [updated] = await db.select({ at: tasks.issueClosedAt }).from(tasks).where(eq(tasks.id, t.id));
    assert.deepEqual(updated.at, when);
  } finally {
    await close();
  }
});
