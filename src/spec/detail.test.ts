import test from "node:test";
import assert from "node:assert/strict";
import { createTestDb } from "../db/client";
import { requirements, tasks, project } from "../db/schema";
import { getRequirementDetail } from "./detail";

test("getRequirementDetail returns the requirement with its tasks; null for unknown", async () => {
  const { db, close } = await createTestDb();
  try {
    assert.equal(await getRequirementDetail(db, "REQ-404"), null);

    const [proj] = await db
      .insert(project)
      .values({ repoFullName: "o/r", installationId: 1, defaultBranch: "main", localClonePath: "/t", specPath: "SPEC.md", claudeMdPath: "CLAUDE.md" })
      .returning({ id: project.id });
    const [r] = await db.insert(requirements).values({ key: "REQ-001", title: "Search", description: "d", provenance: "imported", projectId: proj.id }).returning({ id: requirements.id });
    await db.insert(tasks).values({ key: "TASK-001", title: "a", body: "b", requirementId: r.id, effort: 1, risk: "low", confidence: 50, githubIssueUrl: "http://x/1", projectId: proj.id });

    const detail = await getRequirementDetail(db, "REQ-001");
    assert.ok(detail);
    assert.equal(detail!.key, "REQ-001");
    assert.equal(detail!.tasks.length, 1);
    assert.equal(detail!.tasks[0].key, "TASK-001");
    assert.equal(detail!.tasks[0].githubIssueUrl, "http://x/1");
  } finally { await close(); }
});
