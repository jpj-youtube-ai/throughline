import test from "node:test";
import assert from "node:assert/strict";
import { createTestDb, type Db } from "../db/client";
import { users, requirements, tasks, project } from "../db/schema";
import { emitEvent } from "../db/events";
import { listActivity } from "./feed";

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
    .values({ key: "TASK-014", title: "Event log table", body: "b", requirementId: r.id, effort: 1, risk: "low", confidence: 50, projectId: p.id })
    .returning({ id: tasks.id });
  return { userId: u.id, reqId: r.id, taskId: t.id, projectId: p.id };
}

test("listActivity presents events newest-first with human verbs, subject keys, and the why", async () => {
  const { db, close } = await createTestDb();
  try {
    const { userId, reqId, taskId, projectId } = await seed(db);

    // Each in its own transaction so seq strictly increases.
    await db.transaction((tx) =>
      emitEvent(tx, { type: "requirement.declared", subjectType: "requirement", subjectId: reqId, actorId: userId, payload: { key: "REQ-003" }, projectId }),
    );
    await db.transaction((tx) =>
      emitEvent(tx, { type: "task.claimed", subjectType: "task", subjectId: taskId, actorId: userId, payload: {}, projectId }),
    );
    await db.transaction((tx) =>
      emitEvent(tx, { type: "task.github_status_changed", subjectType: "task", subjectId: taskId, payload: { from: "open", to: "closed" }, projectId }),
    );
    await db.transaction((tx) =>
      emitEvent(tx, {
        type: "drift.resolved",
        subjectType: "task",
        subjectId: taskId,
        actorId: userId,
        payload: { resolution: "relink" },
        rationale: "this work belongs to REQ-005",
        projectId,
      }),
    );

    const items = await listActivity(db);
    assert.equal(items.length, 4);

    // newest first
    assert.equal(items[0].type, "drift.resolved");
    assert.equal(items[0].verb, "resolved drift on");
    assert.equal(items[0].subject, "TASK-014");
    assert.equal(items[0].actor, "alice");
    assert.equal(items[0].why, "this work belongs to REQ-005");

    // github status closed => "merged / closed", merge node, no actor (system)
    assert.equal(items[1].type, "task.github_status_changed");
    assert.equal(items[1].verb, "merged / closed");
    assert.equal(items[1].kind, "merge");
    assert.equal(items[1].subject, "TASK-014");
    assert.equal(items[1].actor, null);

    // requirement subject resolves to its key
    assert.equal(items[3].type, "requirement.declared");
    assert.equal(items[3].subject, "REQ-003");
    assert.equal(items[3].verb, "declared");

    // strictly decreasing seq
    assert.ok(items[0].seq > items[1].seq && items[1].seq > items[2].seq && items[2].seq > items[3].seq);
  } finally {
    await close();
  }
});

test("listActivity scopes to projectId when provided", async () => {
  const { db, close } = await createTestDb();
  try {
    const [p1] = await db
      .insert(project)
      .values({ repoFullName: "org/alpha", installationId: 1, defaultBranch: "main", localClonePath: "/a", specPath: "SPEC.md", claudeMdPath: "CLAUDE.md" })
      .returning({ id: project.id });
    const [p2] = await db
      .insert(project)
      .values({ repoFullName: "org/beta", installationId: 2, defaultBranch: "main", localClonePath: "/b", specPath: "SPEC.md", claudeMdPath: "CLAUDE.md" })
      .returning({ id: project.id });
    const [u] = await db.insert(users).values({ githubId: 99, githubLogin: "eve" }).returning({ id: users.id });

    await db.transaction((tx) =>
      emitEvent(tx, { type: "project.bound", subjectType: "project", subjectId: p1.id, actorId: u.id, payload: {}, projectId: p1.id }),
    );
    await db.transaction((tx) =>
      emitEvent(tx, { type: "project.bound", subjectType: "project", subjectId: p2.id, actorId: u.id, payload: {}, projectId: p2.id }),
    );

    const forP1 = await listActivity(db, p1.id);
    assert.equal(forP1.length, 1, "only p1 events returned when scoped to p1");

    const forP2 = await listActivity(db, p2.id);
    assert.equal(forP2.length, 1, "only p2 events returned when scoped to p2");
  } finally {
    await close();
  }
});
