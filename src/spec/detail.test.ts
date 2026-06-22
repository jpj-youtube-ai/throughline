import test from "node:test";
import assert from "node:assert/strict";
import { createTestDb } from "../db/client";
import { requirements, tasks, project } from "../db/schema";
import { getRequirementDetail } from "./detail";

test("getRequirementDetail returns the requirement with its tasks; null for unknown", async () => {
  const { db, close } = await createTestDb();
  try {
    const [proj] = await db
      .insert(project)
      .values({ repoFullName: "o/r", installationId: 1, defaultBranch: "main", localClonePath: "/t", specPath: "SPEC.md", claudeMdPath: "CLAUDE.md" })
      .returning({ id: project.id });

    assert.equal(await getRequirementDetail(db, proj.id, "REQ-404"), null);

    const [r] = await db.insert(requirements).values({ key: "REQ-001", title: "Search", description: "d", provenance: "imported", projectId: proj.id }).returning({ id: requirements.id });
    await db.insert(tasks).values({ key: "TASK-001", title: "a", body: "b", requirementId: r.id, effort: 1, risk: "low", confidence: 50, githubIssueUrl: "http://x/1", projectId: proj.id });

    const detail = await getRequirementDetail(db, proj.id, "REQ-001");
    assert.ok(detail);
    assert.equal(detail!.key, "REQ-001");
    assert.equal(detail!.tasks.length, 1);
    assert.equal(detail!.tasks[0].key, "TASK-001");
    assert.equal(detail!.tasks[0].githubIssueUrl, "http://x/1");
  } finally { await close(); }
});

test("getRequirementDetail(db, projectId, key) is scoped: same key in two projects returns the right one", async () => {
  const { db, close } = await createTestDb();
  try {
    const [p1] = await db
      .insert(project)
      .values({ repoFullName: "org/repo1", installationId: 1, defaultBranch: "main", localClonePath: "/p1", specPath: "SPEC.md", claudeMdPath: "CLAUDE.md" })
      .returning({ id: project.id });
    const [p2] = await db
      .insert(project)
      .values({ repoFullName: "org/repo2", installationId: 2, defaultBranch: "main", localClonePath: "/p2", specPath: "SPEC.md", claudeMdPath: "CLAUDE.md" })
      .returning({ id: project.id });

    const [r1] = await db
      .insert(requirements)
      .values({ key: "REQ-001", title: "P1 feature", description: "from p1", provenance: "imported", projectId: p1.id })
      .returning({ id: requirements.id });
    const [r2] = await db
      .insert(requirements)
      .values({ key: "REQ-001", title: "P2 feature", description: "from p2", provenance: "imported", projectId: p2.id })
      .returning({ id: requirements.id });

    await db.insert(tasks).values({ key: "TASK-100", title: "p1 task", body: "b", requirementId: r1.id, effort: 1, risk: "low", confidence: 50, projectId: p1.id });
    await db.insert(tasks).values({ key: "TASK-200", title: "p2 task", body: "b", requirementId: r2.id, effort: 1, risk: "low", confidence: 50, projectId: p2.id });

    const d1 = await getRequirementDetail(db, p1.id, "REQ-001");
    assert.ok(d1);
    assert.equal(d1.title, "P1 feature");
    assert.deepEqual(d1.tasks.map((t) => t.key), ["TASK-100"]);

    const d2 = await getRequirementDetail(db, p2.id, "REQ-001");
    assert.ok(d2);
    assert.equal(d2.title, "P2 feature");
    assert.deepEqual(d2.tasks.map((t) => t.key), ["TASK-200"]);

    // Wrong project for a key that exists in the other project → null
    assert.equal(await getRequirementDetail(db, p1.id, "REQ-999"), null);
  } finally { await close(); }
});
