import test from "node:test";
import assert from "node:assert/strict";
import { createTestDb, type Db } from "../db/client";
import { project, requirements, tasks } from "../db/schema";
import { createIssuesForTasks, type OpenIssueFn } from "./issues";

async function seedProject(
  db: Db,
  repoFullName: string,
  installationId: number,
): Promise<{ projId: string; reqId: string }> {
  const [proj] = await db.insert(project).values({
    repoFullName,
    defaultBranch: "main",
    installationId,
    localClonePath: "/x",
  }).returning({ id: project.id });
  const [req] = await db
    .insert(requirements)
    .values({ key: `REQ-${installationId.toString().padStart(3, "0")}`, title: "t", description: "d", provenance: "imported", projectId: proj.id })
    .returning({ id: requirements.id });
  return { projId: proj.id, reqId: req.id };
}

async function seed(db: Db): Promise<string> {
  const { projId, reqId } = await seedProject(db, "acme/repo", 99);
  await db.insert(tasks).values([
    { key: "TASK-001", title: "A", body: "b", requirementId: reqId, effort: 1, risk: "low", confidence: 50, projectId: projId },
    { key: "TASK-002", title: "B", body: "b", requirementId: reqId, effort: 1, risk: "low", confidence: 50, projectId: projId },
  ]);
  return projId;
}

test("createIssuesForTasks opens an issue per task without one, stores the ref, idempotently", async () => {
  const { db, close } = await createTestDb();
  try {
    const projId = await seed(db);
    let n = 100;
    const calls: string[] = [];
    const fakeOpen: OpenIssueFn = async (installationId, repoFullName, title) => {
      calls.push(`${installationId}:${repoFullName}:${title}`);
      n += 1;
      return { number: n, url: `https://github.com/${repoFullName}/issues/${n}` };
    };

    const r1 = await createIssuesForTasks(db, projId, fakeOpen);
    assert.deepEqual(r1.created.sort(), ["TASK-001", "TASK-002"]);
    assert.ok(calls.some((c) => c.includes("[TASK-001] A")), "issue title carries the task key");
    assert.ok(calls.every((c) => c.startsWith("99:acme/repo:")), "uses the project installation + repo");

    const t = await db.select().from(tasks);
    assert.ok(t.every((x) => x.githubIssueNumber != null && x.githubIssueUrl != null), "refs stored");

    // Second run: nothing left without an issue.
    const r2 = await createIssuesForTasks(db, projId, fakeOpen);
    assert.equal(r2.created.length, 0);
  } finally {
    await close();
  }
});

test("createIssuesForTasks(db, projectId) only touches that project's tasks — not another project's", async () => {
  const { db, close } = await createTestDb();
  try {
    // Seed two separate projects
    const { projId: pA, reqId: reqA } = await seedProject(db, "acme/alpha", 10);
    const { projId: pB, reqId: reqB } = await seedProject(db, "acme/beta", 20);

    await db.insert(tasks).values([
      { key: "TASK-001", title: "Alpha task", body: "b", requirementId: reqA, effort: 1, risk: "low", confidence: 50, projectId: pA },
    ]);
    await db.insert(tasks).values([
      { key: "TASK-001", title: "Beta task", body: "b", requirementId: reqB, effort: 1, risk: "low", confidence: 50, projectId: pB },
      { key: "TASK-002", title: "Beta task 2", body: "b", requirementId: reqB, effort: 1, risk: "low", confidence: 50, projectId: pB },
    ]);

    let n = 200;
    const calls: string[] = [];
    const fakeOpen: OpenIssueFn = async (installationId, repoFullName, title) => {
      calls.push(`${installationId}:${repoFullName}:${title}`);
      n += 1;
      return { number: n, url: `https://github.com/${repoFullName}/issues/${n}` };
    };

    // Process only project B
    const r = await createIssuesForTasks(db, pB, fakeOpen);
    assert.deepEqual(r.created.sort(), ["TASK-001", "TASK-002"]);
    // All calls use project B's installation and repo
    assert.ok(calls.every((c) => c.startsWith("20:acme/beta:")), "only B's installation/repo used");

    // Project A's task still has no issue number
    const allTasks = await db.select({ key: tasks.key, projectId: tasks.projectId, issueNumber: tasks.githubIssueNumber }).from(tasks);
    const aTask = allTasks.find((t) => t.projectId === pA);
    assert.equal(aTask?.issueNumber, null, "project A task untouched");
    const bTasks = allTasks.filter((t) => t.projectId === pB);
    assert.ok(bTasks.every((t) => t.issueNumber != null), "project B tasks got issues");
  } finally {
    await close();
  }
});

test("createIssuesForTasks without projectId defaults to oldest project", async () => {
  const { db, close } = await createTestDb();
  try {
    const { projId, reqId } = await seedProject(db, "acme/repo", 99);
    await db.insert(tasks).values([
      { key: "TASK-001", title: "A", body: "b", requirementId: reqId, effort: 1, risk: "low", confidence: 50, projectId: projId },
    ]);
    let n = 300;
    const fakeOpen: OpenIssueFn = async (_i, repoFullName) => {
      n += 1;
      return { number: n, url: `https://github.com/${repoFullName}/issues/${n}` };
    };
    // No projectId passed — should default to oldest (the only one)
    const r = await createIssuesForTasks(db, undefined, fakeOpen);
    assert.deepEqual(r.created, ["TASK-001"]);
  } finally {
    await close();
  }
});
