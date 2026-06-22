import test from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { createTestDb } from "../db/client";
import { project, tasks, requirements } from "../db/schema";
import { createBranch, createBranchesForClaimedTasks, kickoffComment, type GitRefClient, type CreateBranchFn, type CommentOnIssueFn } from "./branches";

const okClient: GitRefClient = {
  rest: {
    git: {
      getRef: async () => ({ data: { object: { sha: "basesha" } } }),
      createRef: async () => ({}),
    },
  },
};

test("createBranch returns created:true on a fresh ref", async () => {
  assert.deepEqual(await createBranch(1, "o/r", "task-001-x", "main", okClient), { created: true });
});

test("createBranch is idempotent: a 422 (ref exists) returns created:false", async () => {
  const client: GitRefClient = {
    rest: {
      git: {
        getRef: async () => ({ data: { object: { sha: "s" } } }),
        createRef: async () => {
          throw Object.assign(new Error("Reference already exists"), { status: 422 });
        },
      },
    },
  };
  assert.deepEqual(await createBranch(1, "o/r", "task-001-x", "main", client), { created: false });
});

test("createBranch rethrows non-422 errors", async () => {
  const client: GitRefClient = {
    rest: {
      git: {
        getRef: async () => ({ data: { object: { sha: "s" } } }),
        createRef: async () => {
          throw Object.assign(new Error("boom"), { status: 500 });
        },
      },
    },
  };
  await assert.rejects(() => createBranch(1, "o/r", "b", "main", client), /boom/);
});

async function seedProject(
  db: Awaited<ReturnType<typeof createTestDb>>["db"],
  repoFullName: string,
  installationId: number,
  reqKey: string,
) {
  const [proj] = await db.insert(project).values({
    repoFullName, installationId, defaultBranch: "main",
    localClonePath: "/tmp", specPath: "SPEC.md", claudeMdPath: "CLAUDE.md",
  }).returning({ id: project.id });
  const [req] = await db
    .insert(requirements)
    .values({ key: reqKey, title: "t", description: "d", provenance: "imported", projectId: proj.id })
    .returning({ id: requirements.id });
  return { reqId: req.id, projId: proj.id };
}

async function seed(db: Awaited<ReturnType<typeof createTestDb>>["db"]) {
  return seedProject(db, "o/r", 1, "REQ-001");
}

test("createBranchesForClaimedTasks branches claimed+unbranched tasks, sets the timestamp, skips the rest", async () => {
  const { db, close } = await createTestDb();
  try {
    const { reqId, projId } = await seed(db);
    await db.insert(tasks).values({ key: "TASK-001", title: "a", body: "b", requirementId: reqId, effort: 1, risk: "low", confidence: 50, claimState: "claimed", branchName: "task-001-a", projectId: projId });
    await db.insert(tasks).values({ key: "TASK-002", title: "b", body: "b", requirementId: reqId, effort: 1, risk: "low", confidence: 50, claimState: "claimed", branchName: "task-002-b", branchCreatedAt: new Date(), projectId: projId });
    await db.insert(tasks).values({ key: "TASK-003", title: "c", body: "b", requirementId: reqId, effort: 1, risk: "low", confidence: 50, claimState: "unclaimed", projectId: projId });

    const calls: string[] = [];
    const fake: CreateBranchFn = async (_i, _r, branch) => { calls.push(branch); return { created: true }; };
    const { created } = await createBranchesForClaimedTasks(db, projId, fake);

    assert.deepEqual(created, ["TASK-001"]);
    assert.deepEqual(calls, ["task-001-a"]);
    const [t1] = await db.select({ b: tasks.branchCreatedAt }).from(tasks).where(eq(tasks.key, "TASK-001"));
    assert.ok(t1.b instanceof Date);
  } finally {
    await close();
  }
});

test("createBranchesForClaimedTasks leaves branchCreatedAt null when creation throws (retried next sweep)", async () => {
  const { db, close } = await createTestDb();
  try {
    const { reqId, projId } = await seed(db);
    await db.insert(tasks).values({ key: "TASK-001", title: "a", body: "b", requirementId: reqId, effort: 1, risk: "low", confidence: 50, claimState: "claimed", branchName: "task-001-a", projectId: projId });
    const failing: CreateBranchFn = async () => { throw new Error("github down"); };
    await assert.rejects(() => createBranchesForClaimedTasks(db, projId, failing), /github down/);
    const [t1] = await db.select({ b: tasks.branchCreatedAt }).from(tasks).where(eq(tasks.key, "TASK-001"));
    assert.equal(t1.b, null);
  } finally {
    await close();
  }
});

test("createBranchesForClaimedTasks throws when no project is bound", async () => {
  const { db, close } = await createTestDb();
  try {
    await assert.rejects(() => createBranchesForClaimedTasks(db, undefined, okClient as unknown as CreateBranchFn), /No project bound/);
  } finally {
    await close();
  }
});

test("createBranchesForClaimedTasks posts a kickoff comment for a task with an issue number, skips one without", async () => {
  const { db, close } = await createTestDb();
  try {
    const { reqId, projId } = await seed(db);
    await db.insert(tasks).values({ key: "TASK-010", title: "a", body: "b", requirementId: reqId, effort: 1, risk: "low", confidence: 50, claimState: "claimed", branchName: "task-010-a", githubIssueNumber: 42, projectId: projId });
    await db.insert(tasks).values({ key: "TASK-011", title: "b", body: "b", requirementId: reqId, effort: 1, risk: "low", confidence: 50, claimState: "claimed", branchName: "task-011-b", projectId: projId });

    const branchFake: CreateBranchFn = async () => ({ created: true });
    const comments: { issueNumber: number; body: string }[] = [];
    const commentFake: CommentOnIssueFn = async (_i, _r, issueNumber, body) => {
      comments.push({ issueNumber, body });
    };

    const { created } = await createBranchesForClaimedTasks(db, projId, branchFake, commentFake);
    assert.deepEqual(created.sort(), ["TASK-010", "TASK-011"]);

    assert.equal(comments.length, 1); // only TASK-010 has an issue
    assert.equal(comments[0].issueNumber, 42);
    assert.match(comments[0].body, /TASK-010/);
    assert.match(comments[0].body, /task-010-a/);

    const rows = await db.select({ b: tasks.branchCreatedAt }).from(tasks);
    assert.ok(rows.every((r) => r.b instanceof Date)); // both branches recorded
  } finally {
    await close();
  }
});

test("createBranchesForClaimedTasks(db, pB) only touches B's tasks — not A's", async () => {
  const { db, close } = await createTestDb();
  try {
    const { reqId: reqA, projId: pA } = await seedProject(db, "acme/alpha", 10, "REQ-001");
    const { reqId: reqB, projId: pB } = await seedProject(db, "acme/beta", 20, "REQ-002");

    // Project A: one claimed task
    await db.insert(tasks).values({ key: "TASK-001", title: "Alpha", body: "b", requirementId: reqA, effort: 1, risk: "low", confidence: 50, claimState: "claimed", branchName: "task-001-alpha", projectId: pA });
    // Project B: one claimed task
    await db.insert(tasks).values({ key: "TASK-001", title: "Beta", body: "b", requirementId: reqB, effort: 1, risk: "low", confidence: 50, claimState: "claimed", branchName: "task-001-beta", projectId: pB });

    const calls: string[] = [];
    const fakeBranch: CreateBranchFn = async (_i, repoFullName, branch) => {
      calls.push(`${repoFullName}:${branch}`);
      return { created: true };
    };

    // Process only project B
    const { created } = await createBranchesForClaimedTasks(db, pB, fakeBranch);
    assert.deepEqual(created, ["TASK-001"]);
    assert.ok(calls.every((c) => c.startsWith("acme/beta:")), "only B's repo used");

    // Project A's task still has no branch timestamp
    const allTasks = await db.select({ projectId: tasks.projectId, branchCreatedAt: tasks.branchCreatedAt }).from(tasks);
    const aTask = allTasks.find((t) => t.projectId === pA);
    assert.equal(aTask?.branchCreatedAt, null, "project A task untouched");
    const bTask = allTasks.find((t) => t.projectId === pB);
    assert.ok(bTask?.branchCreatedAt instanceof Date, "project B task branched");
  } finally {
    await close();
  }
});

test("createBranchesForClaimedTasks without projectId defaults to oldest project", async () => {
  const { db, close } = await createTestDb();
  try {
    const { reqId, projId } = await seed(db);
    await db.insert(tasks).values({ key: "TASK-001", title: "a", body: "b", requirementId: reqId, effort: 1, risk: "low", confidence: 50, claimState: "claimed", branchName: "task-001-a", projectId: projId });
    const fake: CreateBranchFn = async () => ({ created: true });
    // No projectId passed — defaults to oldest (the only one)
    const { created } = await createBranchesForClaimedTasks(db, undefined, fake);
    assert.deepEqual(created, ["TASK-001"]);
  } finally {
    await close();
  }
});

test("kickoffComment includes the task key, the branch, and the PR-title convention", () => {
  const c = kickoffComment("TASK-007", "task-007-do-the-thing");
  assert.match(c, /TASK-007/);
  assert.match(c, /task-007-do-the-thing/);
  assert.match(c, /\[TASK-007\]/); // the [TASK-NNN] PR title convention
  assert.match(c, /Claude Code/);
});
