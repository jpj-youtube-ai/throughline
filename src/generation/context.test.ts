import test from "node:test";
import assert from "node:assert/strict";
import { createTestDb, type Db } from "../db/client";
import { project, requirements, tasks } from "../db/schema";
import { projectTaskSummary } from "./context";

async function seed(db: Db, repo: string, inst: number): Promise<{ pid: string; reqId: string }> {
  const [p] = await db.insert(project).values({ repoFullName: repo, defaultBranch: "main", installationId: inst, localClonePath: "/x" }).returning({ id: project.id });
  const [r] = await db.insert(requirements).values({ key: "REQ-001", title: "t", description: "d", provenance: "imported", projectId: p.id }).returning({ id: requirements.id });
  return { pid: p.id, reqId: r.id };
}

test("projectTaskSummary lists tasks newest-first with status-label precedence", async () => {
  const { db, close } = await createTestDb();
  try {
    const { pid, reqId } = await seed(db, "a/b", 1);
    const base = { body: "b", requirementId: reqId, effort: 1, risk: "low" as const, confidence: 50, projectId: pid };
    await db.insert(tasks).values({ ...base, key: "TASK-001", title: "Open one", createdAt: new Date("2026-01-01T00:00:00Z") });
    await db.insert(tasks).values({ ...base, key: "TASK-002", title: "Claimed one", claimState: "claimed", createdAt: new Date("2026-01-02T00:00:00Z") });
    await db.insert(tasks).values({ ...base, key: "TASK-003", title: "Done one", githubStatus: "closed", claimState: "claimed", createdAt: new Date("2026-01-03T00:00:00Z") });

    const lines = await projectTaskSummary(db, pid);
    assert.deepEqual(lines, [
      "TASK-003 [closed] — Done one → REQ-001", // closed wins over claimed
      "TASK-002 [claimed] — Claimed one → REQ-001",
      "TASK-001 [open] — Open one → REQ-001",
    ]);
  } finally {
    await close();
  }
});

test("projectTaskSummary is project-scoped and respects the limit", async () => {
  const { db, close } = await createTestDb();
  try {
    const a = await seed(db, "a/alpha", 1);
    const b = await seed(db, "a/beta", 2);
    await db.insert(tasks).values({ key: "TASK-001", title: "Alpha", body: "b", requirementId: a.reqId, effort: 1, risk: "low", confidence: 50, projectId: a.pid });
    await db.insert(tasks).values({ key: "TASK-001", title: "Beta1", body: "b", requirementId: b.reqId, effort: 1, risk: "low", confidence: 50, projectId: b.pid });
    await db.insert(tasks).values({ key: "TASK-002", title: "Beta2", body: "b", requirementId: b.reqId, effort: 1, risk: "low", confidence: 50, projectId: b.pid });

    const bLines = await projectTaskSummary(db, b.pid);
    assert.equal(bLines.length, 2, "only project B's tasks");
    assert.ok(bLines.every((l) => l.includes("Beta")), "no project A leakage");
    assert.equal((await projectTaskSummary(db, b.pid, { limit: 1 })).length, 1);
  } finally {
    await close();
  }
});
