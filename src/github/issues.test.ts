import test from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { createTestDb, type Db } from "../db/client";
import { project, requirements, tasks } from "../db/schema";
import { createIssuesForTasks, closeIssuesForMergedTasks, type OpenIssueFn, type CloseIssueFn } from "./issues";

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

async function seedOnePendingTask(db: Db) {
  const [p] = await db.insert(project).values({ repoFullName: "acme/repo", installationId: 1, defaultBranch: "main", localClonePath: "/x" }).returning({ id: project.id });
  const [r] = await db.insert(requirements).values({ key: "REQ-001", title: "t", description: "d", provenance: "imported", projectId: p.id }).returning({ id: requirements.id });
  const [t] = await db.insert(tasks).values({ key: "TASK-001", title: "T one", body: "body one", requirementId: r.id, effort: 1, risk: "low", confidence: 50, projectId: p.id }).returning({ id: tasks.id });
  return { projectId: p.id, taskId: t.id, key: "TASK-001" };
}

test("createIssuesForTasks embeds the preview image and stores it", async () => {
  const { db, close } = await createTestDb();
  try {
    const ids = await seedOnePendingTask(db); // {projectId, taskId, key}
    const bodies: string[] = [];
    const openIssue = async (_i: number, _r: string, _t: string, body: string) => { bodies.push(body); return { number: 1, url: "u" }; };
    await createIssuesForTasks(db, ids.projectId, openIssue, {
      generatePreview: async () => "<html><body>mock</body></html>",
      renderPng: async () => Buffer.from([0x89, 0x50, 0x4e, 0x47, 1]),
      baseUrl: "https://example.test",
    });
    assert.match(bodies[0], new RegExp(`^!\\[preview\\]\\(https://example\\.test/preview/${ids.taskId}\\.png\\)`));
    const [t] = await db.select({ img: tasks.previewImage, html: tasks.previewHtml }).from(tasks).where(eq(tasks.id, ids.taskId));
    assert.ok(t.img && t.html);
  } finally { await close(); }
});

test("createIssuesForTasks still creates the issue when preview generation fails", async () => {
  const { db, close } = await createTestDb();
  try {
    const ids = await seedOnePendingTask(db);
    const bodies: string[] = [];
    const openIssue = async (_i: number, _r: string, _t: string, body: string) => { bodies.push(body); return { number: 2, url: "u" }; };
    await createIssuesForTasks(db, ids.projectId, openIssue, {
      generatePreview: async () => null, // LLM failed/skipped
      renderPng: async () => { throw new Error("should not be called"); },
      baseUrl: "https://example.test",
    });
    assert.ok(!bodies[0].includes("![preview]"));
    const [t] = await db.select({ num: tasks.githubIssueNumber }).from(tasks).where(eq(tasks.id, ids.taskId));
    assert.equal(t.num, 2); // issue created regardless
  } finally { await close(); }
});

test("createIssuesForTasks still creates the issue when rendering throws", async () => {
  const { db, close } = await createTestDb();
  try {
    const ids = await seedOnePendingTask(db);
    const bodies: string[] = [];
    const openIssue = async (_i: number, _r: string, _t: string, body: string) => { bodies.push(body); return { number: 3, url: "u" }; };
    await createIssuesForTasks(db, ids.projectId, openIssue, {
      generatePreview: async () => "<html><body>x</body></html>",
      renderPng: async () => { throw new Error("chromium boom"); },
      baseUrl: "https://example.test",
    });
    assert.ok(!bodies[0].includes("![preview]"));
    const [t] = await db.select({ num: tasks.githubIssueNumber }).from(tasks).where(eq(tasks.id, ids.taskId));
    assert.equal(t.num, 3);
  } finally { await close(); }
});

test("closeIssuesForMergedTasks closes merged tasks' issues, marks them once, idempotently", async () => {
  const { db, close } = await createTestDb();
  try {
    const { projId, reqId } = await seedProject(db, "acme/repo", 77);
    await db.insert(tasks).values([
      // eligible: closed + has an issue + not yet marked
      { key: "TASK-001", title: "A", body: "b", requirementId: reqId, effort: 1, risk: "low", confidence: 50, projectId: projId, githubStatus: "closed", githubIssueNumber: 11 },
      // not eligible: still open
      { key: "TASK-002", title: "B", body: "b", requirementId: reqId, effort: 1, risk: "low", confidence: 50, projectId: projId, githubStatus: "open", githubIssueNumber: 12 },
      // not eligible: closed but no issue number
      { key: "TASK-003", title: "C", body: "b", requirementId: reqId, effort: 1, risk: "low", confidence: 50, projectId: projId, githubStatus: "closed" },
    ]);

    const calls: Array<{ installationId: number; repo: string; issue: number }> = [];
    const fakeClose: CloseIssueFn = async (installationId, repo, issue) => {
      calls.push({ installationId, repo, issue });
    };

    const r1 = await closeIssuesForMergedTasks(db, projId, fakeClose);
    assert.deepEqual(r1.closed, ["TASK-001"]);
    assert.deepEqual(calls, [{ installationId: 77, repo: "acme/repo", issue: 11 }]);

    const [t1] = await db.select({ at: tasks.issueClosedAt }).from(tasks).where(eq(tasks.key, "TASK-001"));
    assert.ok(t1.at instanceof Date, "issue_closed_at marked on success");

    // Second sweep: nothing left, no re-close.
    const r2 = await closeIssuesForMergedTasks(db, projId, fakeClose);
    assert.deepEqual(r2.closed, []);
    assert.equal(calls.length, 1, "no re-close on the second sweep");
  } finally {
    await close();
  }
});

test("closeIssuesForMergedTasks: a per-task close failure leaves it unmarked and does not block others", async () => {
  const { db, close } = await createTestDb();
  try {
    const { projId, reqId } = await seedProject(db, "acme/repo", 55);
    await db.insert(tasks).values([
      { key: "TASK-001", title: "A", body: "b", requirementId: reqId, effort: 1, risk: "low", confidence: 50, projectId: projId, githubStatus: "closed", githubIssueNumber: 1 },
      { key: "TASK-002", title: "B", body: "b", requirementId: reqId, effort: 1, risk: "low", confidence: 50, projectId: projId, githubStatus: "closed", githubIssueNumber: 2 },
    ]);

    const fakeClose: CloseIssueFn = async (_i, _r, issue) => {
      if (issue === 1) throw new Error("github boom");
    };

    const r = await closeIssuesForMergedTasks(db, projId, fakeClose);
    assert.deepEqual(r.closed, ["TASK-002"], "the healthy task still closed");

    const rows = await db.select({ key: tasks.key, at: tasks.issueClosedAt }).from(tasks);
    const t1 = rows.find((x) => x.key === "TASK-001");
    const t2 = rows.find((x) => x.key === "TASK-002");
    assert.equal(t1?.at, null, "failed task left unmarked (retryable next tick)");
    assert.ok(t2?.at instanceof Date, "succeeded task marked");
  } finally {
    await close();
  }
});

test("closeIssuesForMergedTasks is project-scoped: another project's closed task is untouched", async () => {
  const { db, close } = await createTestDb();
  try {
    const { projId: pA, reqId: rA } = await seedProject(db, "acme/alpha", 10);
    const { projId: pB, reqId: rB } = await seedProject(db, "acme/beta", 20);
    await db.insert(tasks).values([
      { key: "TASK-001", title: "Alpha", body: "b", requirementId: rA, effort: 1, risk: "low", confidence: 50, projectId: pA, githubStatus: "closed", githubIssueNumber: 1 },
      { key: "TASK-001", title: "Beta", body: "b", requirementId: rB, effort: 1, risk: "low", confidence: 50, projectId: pB, githubStatus: "closed", githubIssueNumber: 1 },
    ]);

    const calls: number[] = [];
    const fakeClose: CloseIssueFn = async (installationId) => { calls.push(installationId); };

    const r = await closeIssuesForMergedTasks(db, pB, fakeClose);
    assert.deepEqual(r.closed, ["TASK-001"]);
    assert.deepEqual(calls, [20], "only project B's installation used");

    const rows = await db.select({ pid: tasks.projectId, at: tasks.issueClosedAt }).from(tasks);
    const a = rows.find((x) => x.pid === pA);
    assert.equal(a?.at, null, "project A untouched");
  } finally {
    await close();
  }
});

