import test from "node:test";
import assert from "node:assert/strict";
import { createTestDb, type Db } from "../db/client";
import { project, requirements, tasks } from "../db/schema";
import { createIssuesForTasks, type OpenIssueFn } from "./issues";

async function seed(db: Db): Promise<void> {
  await db.insert(project).values({
    repoFullName: "acme/repo",
    defaultBranch: "main",
    installationId: 99,
    localClonePath: "/x",
  });
  const [req] = await db
    .insert(requirements)
    .values({ key: "REQ-001", title: "t", description: "d", provenance: "imported" })
    .returning({ id: requirements.id });
  await db.insert(tasks).values([
    { key: "TASK-001", title: "A", body: "b", requirementId: req.id, effort: 1, risk: "low", confidence: 50 },
    { key: "TASK-002", title: "B", body: "b", requirementId: req.id, effort: 1, risk: "low", confidence: 50 },
  ]);
}

test("createIssuesForTasks opens an issue per task without one, stores the ref, idempotently", async () => {
  const { db, close } = await createTestDb();
  try {
    await seed(db);
    let n = 100;
    const calls: string[] = [];
    const fakeOpen: OpenIssueFn = async (installationId, repoFullName, title) => {
      calls.push(`${installationId}:${repoFullName}:${title}`);
      n += 1;
      return { number: n, url: `https://github.com/${repoFullName}/issues/${n}` };
    };

    const r1 = await createIssuesForTasks(db, fakeOpen);
    assert.deepEqual(r1.created.sort(), ["TASK-001", "TASK-002"]);
    assert.ok(calls.some((c) => c.includes("[TASK-001] A")), "issue title carries the task key");
    assert.ok(calls.every((c) => c.startsWith("99:acme/repo:")), "uses the project installation + repo");

    const t = await db.select().from(tasks);
    assert.ok(t.every((x) => x.githubIssueNumber != null && x.githubIssueUrl != null), "refs stored");

    // Second run: nothing left without an issue.
    const r2 = await createIssuesForTasks(db, fakeOpen);
    assert.equal(r2.created.length, 0);
  } finally {
    await close();
  }
});
