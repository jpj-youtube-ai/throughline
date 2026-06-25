import test from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { createTestDb, type Db } from "../db/client";
import { users, requirements, tasks, events, project } from "../db/schema";
import { claimAndBranch } from "./claim-and-branch";

async function seed(db: Db): Promise<{ taskId: string; userId: string }> {
  const [proj] = await db.insert(project).values({ repoFullName: "acme/repo", defaultBranch: "main", installationId: 1, localClonePath: "/x" }).returning({ id: project.id });
  const [u] = await db.insert(users).values({ githubId: 1, githubLogin: "alice" }).returning({ id: users.id });
  const [req] = await db.insert(requirements).values({ key: "REQ-001", title: "t", description: "d", provenance: "imported", projectId: proj.id }).returning({ id: requirements.id });
  const [task] = await db.insert(tasks).values({ key: "TASK-001", title: "Event log", body: "b", requirementId: req.id, effort: 1, risk: "low", confidence: 50, projectId: proj.id }).returning({ id: tasks.id });
  return { taskId: task.id, userId: u.id };
}

test("claimAndBranch claims an unclaimed task and emits task.claimed (branch sweep injected)", async () => {
  const { db, close } = await createTestDb();
  try {
    const { taskId, userId } = await seed(db);
    const sweepCalls: Array<string | undefined> = [];
    const r = await claimAndBranch(db, taskId, userId, async (_d, pid) => { sweepCalls.push(pid); return { created: [] }; });

    assert.equal(r.claimed, true);
    assert.equal(r.branchCreated, false, "injected no-op sweep leaves branch_created_at null");
    assert.equal(sweepCalls.length, 1, "branch sweep invoked once after the claim");
    const [t] = await db.select().from(tasks).where(eq(tasks.id, taskId));
    assert.equal(t.claimState, "claimed");
    assert.equal(t.claimUserId, userId);
    const claimed = await db.select().from(events).where(eq(events.type, "task.claimed"));
    assert.equal(claimed.length, 1);
  } finally {
    await close();
  }
});

test("claimAndBranch returns claimed:false for an already-claimed task and does not run the sweep", async () => {
  const { db, close } = await createTestDb();
  try {
    const { taskId, userId } = await seed(db);
    await claimAndBranch(db, taskId, userId, async () => ({ created: [] }));

    let called = false;
    const r = await claimAndBranch(db, taskId, userId, async () => { called = true; return { created: [] }; });
    assert.equal(r.claimed, false);
    assert.equal(called, false, "no sweep on a lost claim");
    assert.equal((await db.select().from(events).where(eq(events.type, "task.claimed"))).length, 1, "no second claim event");
  } finally {
    await close();
  }
});
