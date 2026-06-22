import test from "node:test";
import assert from "node:assert/strict";
import { createTestDb } from "../db/client";
import { requirements, tasks, project } from "../db/schema";
import { listSpecMap } from "./map";

test("listSpecMap returns requirements by key with their linked tasks", async () => {
  const { db, close } = await createTestDb();
  try {
    const [proj] = await db
      .insert(project)
      .values({ repoFullName: "o/r", installationId: 1, defaultBranch: "main", localClonePath: "/t", specPath: "SPEC.md", claudeMdPath: "CLAUDE.md" })
      .returning({ id: project.id });
    const [r3] = await db
      .insert(requirements)
      .values({ key: "REQ-003", title: "Event log", description: "the spine", provenance: "imported", status: "shipped", projectId: proj.id })
      .returning({ id: requirements.id });
    await db
      .insert(requirements)
      .values({ key: "REQ-009", title: "Webhook", description: "", provenance: "voted", status: "planned", projectId: proj.id });
    await db.insert(tasks).values([
      { key: "TASK-001", title: "table", body: "b", requirementId: r3.id, effort: 1, risk: "low", confidence: 50, githubStatus: "closed", projectId: proj.id },
      { key: "TASK-002", title: "trigger", body: "b", requirementId: r3.id, effort: 1, risk: "low", confidence: 50, projectId: proj.id },
    ]);

    const map = await listSpecMap(db);
    assert.deepEqual(
      map.map((r) => r.key),
      ["REQ-003", "REQ-009"],
    );

    const req3 = map[0];
    assert.equal(req3.status, "shipped");
    assert.equal(req3.provenance, "imported");
    assert.deepEqual(
      req3.tasks.map((t) => t.key),
      ["TASK-001", "TASK-002"],
    );
    assert.equal(req3.tasks[0].githubStatus, "closed");

    assert.equal(map[1].tasks.length, 0);
  } finally {
    await close();
  }
});
