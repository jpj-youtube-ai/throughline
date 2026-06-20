import test from "node:test";
import assert from "node:assert/strict";
import { createTestDb, type Db } from "../db/client";
import { users, requirements, tasks } from "../db/schema";
import { emitEvent } from "../db/events";
import { listActivity } from "./feed";

async function seed(db: Db) {
  const [u] = await db.insert(users).values({ githubId: 1, githubLogin: "alice" }).returning({ id: users.id });
  const [r] = await db
    .insert(requirements)
    .values({ key: "REQ-003", title: "Event log", description: "d", provenance: "imported" })
    .returning({ id: requirements.id });
  const [t] = await db
    .insert(tasks)
    .values({ key: "TASK-014", title: "Event log table", body: "b", requirementId: r.id, effort: 1, risk: "low", confidence: 50 })
    .returning({ id: tasks.id });
  return { userId: u.id, reqId: r.id, taskId: t.id };
}

test("listActivity presents events newest-first with human verbs, subject keys, and the why", async () => {
  const { db, close } = await createTestDb();
  try {
    const { userId, reqId, taskId } = await seed(db);

    // Each in its own transaction so seq strictly increases.
    await db.transaction((tx) =>
      emitEvent(tx, { type: "requirement.declared", subjectType: "requirement", subjectId: reqId, actorId: userId, payload: { key: "REQ-003" } }),
    );
    await db.transaction((tx) =>
      emitEvent(tx, { type: "task.claimed", subjectType: "task", subjectId: taskId, actorId: userId, payload: {} }),
    );
    await db.transaction((tx) =>
      emitEvent(tx, { type: "task.github_status_changed", subjectType: "task", subjectId: taskId, payload: { from: "open", to: "closed" } }),
    );
    await db.transaction((tx) =>
      emitEvent(tx, {
        type: "drift.resolved",
        subjectType: "task",
        subjectId: taskId,
        actorId: userId,
        payload: { resolution: "relink" },
        rationale: "this work belongs to REQ-005",
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
