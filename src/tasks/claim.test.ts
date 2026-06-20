import test from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { createTestDb, type Db } from "../db/client";
import { users, requirements, tasks, events } from "../db/schema";
import { claimTask, unclaimTask, branchNameFor, slugify } from "./claim";

async function seed(db: Db): Promise<{ taskId: string; u1: string; u2: string }> {
  const mk = async (gid: number, login: string): Promise<string> =>
    (await db.insert(users).values({ githubId: gid, githubLogin: login }).returning({ id: users.id }))[0].id;
  const u1 = await mk(1, "alice");
  const u2 = await mk(2, "bob");
  const [req] = await db
    .insert(requirements)
    .values({ key: "REQ-003", title: "t", description: "d", provenance: "imported" })
    .returning({ id: requirements.id });
  const [task] = await db
    .insert(tasks)
    .values({ key: "TASK-014", title: "Event log table", body: "b", requirementId: req.id, effort: 3, risk: "med", confidence: 70 })
    .returning({ id: tasks.id });
  return { taskId: task.id, u1, u2 };
}

const countOf = (evs: { type: string }[], type: string) => evs.filter((e) => e.type === type).length;

test("branchNameFor / slugify build the task-<key>-<slug> convention", () => {
  assert.equal(branchNameFor("TASK-014", "Event log table"), "task-014-event-log-table");
  assert.equal(slugify("Make it FAST -- now!"), "make-it-fast-now");
});

test("claimTask atomically claims; a second claimer loses", async () => {
  const { db, close } = await createTestDb();
  try {
    const { taskId, u1, u2 } = await seed(db);
    const r1 = await claimTask(db, taskId, u1);
    assert.equal(r1.claimed, true);
    assert.equal(r1.branchName, "task-014-event-log-table");

    const t = (await db.select().from(tasks).where(eq(tasks.id, taskId)))[0];
    assert.equal(t.claimState, "claimed");
    assert.equal(t.claimUserId, u1);
    assert.equal(t.branchName, "task-014-event-log-table");
    assert.equal(countOf(await db.select().from(events), "task.claimed"), 1);

    // Someone else tries to claim the same task — they lose, nothing changes.
    const r2 = await claimTask(db, taskId, u2);
    assert.equal(r2.claimed, false);
    assert.equal((await db.select().from(tasks).where(eq(tasks.id, taskId)))[0].claimUserId, u1);
    assert.equal(countOf(await db.select().from(events), "task.claimed"), 1, "no second claim event");
  } finally {
    await close();
  }
});

test("unclaimTask releases the claim — only the claimer can", async () => {
  const { db, close } = await createTestDb();
  try {
    const { taskId, u1, u2 } = await seed(db);
    await claimTask(db, taskId, u1);

    await assert.rejects(unclaimTask(db, taskId, u2), /only the claimer/i);

    const r = await unclaimTask(db, taskId, u1);
    assert.equal(r.unclaimed, true);
    const t = (await db.select().from(tasks).where(eq(tasks.id, taskId)))[0];
    assert.equal(t.claimState, "unclaimed");
    assert.equal(t.claimUserId, null);
    assert.equal(t.branchName, null);
    assert.equal(countOf(await db.select().from(events), "task.unclaimed"), 1);
  } finally {
    await close();
  }
});
