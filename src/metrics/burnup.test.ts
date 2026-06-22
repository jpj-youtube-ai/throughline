import test from "node:test";
import assert from "node:assert/strict";
import { createTestDb } from "../db/client";
import { requirements, tasks, events, project } from "../db/schema";
import { burnUpSeries } from "./burnup";

test("burnUpSeries accumulates scope (tasks) and done (first merge per task)", async () => {
  const { db, close } = await createTestDb();
  try {
    const [proj] = await db
      .insert(project)
      .values({ repoFullName: "o/r", installationId: 1, defaultBranch: "main", localClonePath: "/t", specPath: "SPEC.md", claudeMdPath: "CLAUDE.md" })
      .returning({ id: project.id });
    const [r] = await db
      .insert(requirements)
      .values({ key: "REQ-003", title: "Event log", description: "d", provenance: "imported", projectId: proj.id })
      .returning({ id: requirements.id });

    const [t1] = await db
      .insert(tasks)
      .values({ key: "TASK-001", title: "a", body: "b", requirementId: r.id, effort: 1, risk: "low", confidence: 50, createdAt: new Date(1000), projectId: proj.id })
      .returning({ id: tasks.id });
    const [t2] = await db
      .insert(tasks)
      .values({ key: "TASK-002", title: "b", body: "b", requirementId: r.id, effort: 1, risk: "low", confidence: 50, createdAt: new Date(2000), projectId: proj.id })
      .returning({ id: tasks.id });
    await db
      .insert(tasks)
      .values({ key: "TASK-003", title: "c", body: "b", requirementId: r.id, effort: 1, risk: "low", confidence: 50, createdAt: new Date(3000), projectId: proj.id });

    // merges (direct inserts to control timestamps); a duplicate close on t1 must not double-count
    await db.insert(events).values([
      { type: "task.github_status_changed", subjectType: "task", subjectId: t1.id, payload: { to: "closed" }, createdAt: new Date(4000), projectId: proj.id },
      { type: "task.github_status_changed", subjectType: "task", subjectId: t2.id, payload: { to: "closed" }, createdAt: new Date(5000), projectId: proj.id },
      { type: "task.github_status_changed", subjectType: "task", subjectId: t1.id, payload: { to: "closed" }, createdAt: new Date(6000), projectId: proj.id },
    ]);

    const b = await burnUpSeries(db);
    assert.equal(b.scope, 3);
    assert.equal(b.done, 2); // not 3 — t1's second close is ignored

    const last = b.points[b.points.length - 1];
    assert.equal(last.scope, 3);
    assert.equal(last.done, 2);

    // cumulative + monotonic, done never exceeds scope
    let ps = 0;
    let pd = 0;
    for (const p of b.points) {
      assert.ok(p.scope >= ps && p.done >= pd);
      assert.ok(p.done <= p.scope);
      ps = p.scope;
      pd = p.done;
    }
  } finally {
    await close();
  }
});
