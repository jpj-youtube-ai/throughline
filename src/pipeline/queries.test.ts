import test from "node:test";
import assert from "node:assert/strict";
import { createTestDb } from "../db/client";
import { users, ideas, requirements, tasks, project } from "../db/schema";
import { listPipeline } from "./queries";

test("listPipeline buckets ideas and tasks into the five lifecycle stages", async () => {
  const { db, close } = await createTestDb();
  try {
    const [proj] = await db
      .insert(project)
      .values({ repoFullName: "o/r", installationId: 1, defaultBranch: "main", localClonePath: "/t", specPath: "SPEC.md", claudeMdPath: "CLAUDE.md" })
      .returning({ id: project.id });
    const [u] = await db.insert(users).values({ githubId: 1, githubLogin: "alice" }).returning({ id: users.id });
    const [r] = await db
      .insert(requirements)
      .values({ key: "REQ-003", title: "Event log", description: "d", provenance: "imported", projectId: proj.id })
      .returning({ id: requirements.id });

    await db.insert(ideas).values([
      { title: "Voting idea", why: "w", authorId: u.id, state: "voting", projectId: proj.id },
      { title: "Approved idea", why: "w", authorId: u.id, state: "approved", projectId: proj.id },
      { title: "Generated idea", why: "w", authorId: u.id, state: "generated", projectId: proj.id }, // excluded
      { title: "Rejected idea", why: "w", authorId: u.id, state: "rejected", projectId: proj.id }, // excluded
    ]);
    await db.insert(tasks).values([
      { key: "TASK-001", title: "open", body: "b", requirementId: r.id, effort: 1, risk: "low", confidence: 50, claimState: "unclaimed", githubStatus: "open", projectId: proj.id },
      { key: "TASK-002", title: "claimed", body: "b", requirementId: r.id, effort: 1, risk: "low", confidence: 50, claimState: "claimed", githubStatus: "open", projectId: proj.id },
      { key: "TASK-003", title: "merged", body: "b", requirementId: r.id, effort: 1, risk: "low", confidence: 50, claimState: "claimed", githubStatus: "closed", projectId: proj.id },
    ]);

    const stages = await listPipeline(db);
    const by = Object.fromEntries(stages.map((s) => [s.key, s]));

    assert.deepEqual(
      stages.map((s) => s.key),
      ["voting", "approved", "open", "claimed", "merged"],
    );
    assert.equal(by.voting.count, 1);
    assert.equal(by.voting.items[0].label, "Voting idea");
    assert.equal(by.approved.count, 1);
    assert.equal(by.open.count, 1);
    assert.equal(by.open.items[0].label, "TASK-001");
    assert.equal(by.claimed.count, 1);
    assert.equal(by.claimed.items[0].label, "TASK-002");
    assert.equal(by.merged.count, 1);
    assert.equal(by.merged.items[0].label, "TASK-003");
  } finally {
    await close();
  }
});

test("listPipeline with projectId returns only that project's ideas and tasks", async () => {
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

    const [u] = await db.insert(users).values({ githubId: 2, githubLogin: "bob" }).returning({ id: users.id });

    const [rA] = await db
      .insert(requirements)
      .values({ key: "REQ-001", title: "Req A", description: "d", provenance: "imported", projectId: projA.id })
      .returning({ id: requirements.id });
    const [rB] = await db
      .insert(requirements)
      .values({ key: "REQ-001", title: "Req B", description: "d", provenance: "imported", projectId: projB.id })
      .returning({ id: requirements.id });

    await db.insert(ideas).values([
      { title: "Idea A", why: "w", authorId: u.id, state: "voting", projectId: projA.id },
      { title: "Idea B", why: "w", authorId: u.id, state: "voting", projectId: projB.id },
    ]);
    await db.insert(tasks).values([
      { key: "TASK-001", title: "Task A", body: "b", requirementId: rA.id, effort: 1, risk: "low", confidence: 80, projectId: projA.id },
      { key: "TASK-001", title: "Task B", body: "b", requirementId: rB.id, effort: 1, risk: "low", confidence: 80, projectId: projB.id },
    ]);

    const stagesA = await listPipeline(db, projA.id);
    const byA = Object.fromEntries(stagesA.map((s) => [s.key, s]));
    assert.equal(byA.voting.count, 1);
    assert.equal(byA.voting.items[0].label, "Idea A");
    assert.equal(byA.open.count, 1);
    assert.equal(byA.open.items[0].label, "TASK-001");

    const stagesB = await listPipeline(db, projB.id);
    const byB = Object.fromEntries(stagesB.map((s) => [s.key, s]));
    assert.equal(byB.voting.count, 1);
    assert.equal(byB.voting.items[0].label, "Idea B");
    assert.equal(byB.open.count, 1);

    // Cross-check: project A stages contain no project B data
    assert.ok(!byA.voting.items.some((it) => it.label === "Idea B"));
  } finally {
    await close();
  }
});
