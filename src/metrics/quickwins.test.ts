import test from "node:test";
import assert from "node:assert/strict";
import { createTestDb } from "../db/client";
import { requirements, tasks, project } from "../db/schema";
import { scoreTask, listQuickWins } from "./quickwins";

test("scoreTask rewards high confidence, low effort, low risk", () => {
  const best = scoreTask({ effort: 1, risk: "low", confidence: 100 });
  const worst = scoreTask({ effort: 5, risk: "high", confidence: 0 });
  assert.equal(best, 100);
  assert.equal(worst, 0);
  // a cheap confident low-risk task beats an expensive risky uncertain one
  assert.ok(scoreTask({ effort: 1, risk: "low", confidence: 80 }) > scoreTask({ effort: 5, risk: "high", confidence: 80 }));
});

test("listQuickWins ranks only unclaimed/open tasks by score", async () => {
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
    const base = { body: "b", requirementId: r.id, projectId: proj.id };
    await db.insert(tasks).values([
      // a strong quick win
      { key: "TASK-001", title: "easy", ...base, effort: 1, risk: "low", confidence: 90 },
      // a poor pickup
      { key: "TASK-002", title: "hard", ...base, effort: 5, risk: "high", confidence: 40 },
      // claimed — excluded
      { key: "TASK-003", title: "taken", ...base, effort: 1, risk: "low", confidence: 95, claimState: "claimed" },
      // merged — excluded
      { key: "TASK-004", title: "done", ...base, effort: 1, risk: "low", confidence: 95, githubStatus: "closed" },
    ]);

    const wins = await listQuickWins(db);
    assert.deepEqual(
      wins.map((w) => w.key),
      ["TASK-001", "TASK-002"],
    );
    assert.equal(wins[0].requirementKey, "REQ-003");
    assert.ok(wins[0].score > wins[1].score);
  } finally {
    await close();
  }
});

test("listQuickWins with projectId returns only that project's tasks", async () => {
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

    const [rA] = await db
      .insert(requirements)
      .values({ key: "REQ-001", title: "Req A", description: "d", provenance: "imported", projectId: projA.id })
      .returning({ id: requirements.id });
    const [rB] = await db
      .insert(requirements)
      .values({ key: "REQ-001", title: "Req B", description: "d", provenance: "imported", projectId: projB.id })
      .returning({ id: requirements.id });

    await db.insert(tasks).values([
      { key: "TASK-001", title: "Win A", body: "b", requirementId: rA.id, effort: 1, risk: "low", confidence: 90, projectId: projA.id },
      { key: "TASK-001", title: "Win B", body: "b", requirementId: rB.id, effort: 1, risk: "low", confidence: 90, projectId: projB.id },
    ]);

    const winsA = await listQuickWins(db, projA.id);
    assert.equal(winsA.length, 1);
    assert.equal(winsA[0].title, "Win A");

    const winsB = await listQuickWins(db, projB.id);
    assert.equal(winsB.length, 1);
    assert.equal(winsB[0].title, "Win B");
  } finally {
    await close();
  }
});
