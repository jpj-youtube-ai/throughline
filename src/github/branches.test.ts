import test from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { createTestDb } from "../db/client";
import { project, tasks, requirements } from "../db/schema";
import { createBranch, createBranchesForClaimedTasks, kickoffComment, type GitRefClient, type CreateBranchFn } from "./branches";

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

async function seed(db: Awaited<ReturnType<typeof createTestDb>>["db"]) {
  const [proj] = await db.insert(project).values({
    repoFullName: "o/r", installationId: 1, defaultBranch: "main",
    localClonePath: "/tmp", specPath: "SPEC.md", claudeMdPath: "CLAUDE.md",
  }).returning({ id: project.id });
  const [req] = await db
    .insert(requirements)
    .values({ key: "REQ-001", title: "t", description: "d", provenance: "imported", projectId: proj.id })
    .returning({ id: requirements.id });
  return { reqId: req.id, projId: proj.id };
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
    const { created } = await createBranchesForClaimedTasks(db, fake);

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
    await assert.rejects(() => createBranchesForClaimedTasks(db, failing), /github down/);
    const [t1] = await db.select({ b: tasks.branchCreatedAt }).from(tasks).where(eq(tasks.key, "TASK-001"));
    assert.equal(t1.b, null);
  } finally {
    await close();
  }
});

test("createBranchesForClaimedTasks throws when no project is bound", async () => {
  const { db, close } = await createTestDb();
  try {
    await assert.rejects(() => createBranchesForClaimedTasks(db, okClient as unknown as CreateBranchFn), /No project bound/);
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
