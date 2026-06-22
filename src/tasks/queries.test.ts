import test from "node:test";
import assert from "node:assert/strict";
import { createTestDb } from "../db/client";
import { users, requirements, tasks, project } from "../db/schema";
import { listTasks } from "./queries";

test("listTasks returns all tasks when no projectId given", async () => {
  const { db, close } = await createTestDb();
  try {
    const [proj] = await db
      .insert(project)
      .values({ repoFullName: "o/r", installationId: 1, defaultBranch: "main", localClonePath: "/t", specPath: "SPEC.md", claudeMdPath: "CLAUDE.md" })
      .returning({ id: project.id });
    const [r] = await db
      .insert(requirements)
      .values({ key: "REQ-001", title: "Req", description: "d", provenance: "imported", projectId: proj.id })
      .returning({ id: requirements.id });

    await db.insert(tasks).values([
      { key: "TASK-001", title: "First", body: "b", requirementId: r.id, effort: 1, risk: "low", confidence: 80, projectId: proj.id },
      { key: "TASK-002", title: "Second", body: "b", requirementId: r.id, effort: 2, risk: "med", confidence: 60, projectId: proj.id },
    ]);

    const result = await listTasks(db);
    assert.equal(result.length, 2);
    assert.equal(result[0].key, "TASK-001");
    assert.equal(result[1].key, "TASK-002");
  } finally {
    await close();
  }
});

test("listTasks with projectId returns only that project's tasks", async () => {
  const { db, close } = await createTestDb();
  try {
    const [projA] = await db
      .insert(project)
      .values({ repoFullName: "o/a", installationId: 1, defaultBranch: "main", localClonePath: "/a", specPath: "SPEC.md", claudeMdPath: "CLAUDE.md" })
      .returning({ id: project.id });
    const [projB] = await db
      .insert(project)
      .values({ repoFullName: "o/b", installationId: 2, defaultBranch: "main", localClonePath: "/b", specPath: "SPEC.md", claudeMdPath: "CLAUDE.md" })
      .returning({ id: project.id });

    const [u] = await db.insert(users).values({ githubId: 1, githubLogin: "alice" }).returning({ id: users.id });

    const [rA] = await db
      .insert(requirements)
      .values({ key: "REQ-001", title: "Req A", description: "d", provenance: "imported", projectId: projA.id })
      .returning({ id: requirements.id });
    const [rB] = await db
      .insert(requirements)
      .values({ key: "REQ-001", title: "Req B", description: "d", provenance: "imported", projectId: projB.id })
      .returning({ id: requirements.id });

    await db.insert(tasks).values([
      { key: "TASK-001", title: "Task A", body: "b", requirementId: rA.id, effort: 1, risk: "low", confidence: 80, projectId: projA.id },
      { key: "TASK-001", title: "Task B", body: "b", requirementId: rB.id, effort: 1, risk: "low", confidence: 80, projectId: projB.id },
    ]);

    const tasksA = await listTasks(db, projA.id);
    assert.equal(tasksA.length, 1);
    assert.equal(tasksA[0].title, "Task A");
    assert.equal(tasksA[0].key, "TASK-001");

    const tasksB = await listTasks(db, projB.id);
    assert.equal(tasksB.length, 1);
    assert.equal(tasksB[0].title, "Task B");

    // Confirm cross-contamination: project A does not surface project B's task
    assert.ok(!tasksA.some((t) => t.title === "Task B"));
  } finally {
    await close();
  }
});
