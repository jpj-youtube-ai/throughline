import test from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { createTestDb, type Db } from "../db/client";
import { users, requirements, tasks, events, project } from "../db/schema";
import { claimTask, unclaimTask, branchNameFor, slugify } from "./claim";

async function seed(db: Db): Promise<{ taskId: string; u1: string; u2: string; projectId: string }> {
  const [proj] = await db
    .insert(project)
    .values({ repoFullName: "acme/repo", defaultBranch: "main", installationId: 1, localClonePath: "/x" })
    .returning({ id: project.id });
  const mk = async (gid: number, login: string): Promise<string> =>
    (await db.insert(users).values({ githubId: gid, githubLogin: login }).returning({ id: users.id }))[0].id;
  const u1 = await mk(1, "alice");
  const u2 = await mk(2, "bob");
  const [req] = await db
    .insert(requirements)
    .values({ key: "REQ-003", title: "t", description: "d", provenance: "imported", projectId: proj.id })
    .returning({ id: requirements.id });
  const [task] = await db
    .insert(tasks)
    .values({ key: "TASK-014", title: "Event log table", body: "b", requirementId: req.id, effort: 3, risk: "med", confidence: 70, projectId: proj.id })
    .returning({ id: tasks.id });
  return { taskId: task.id, u1, u2, projectId: proj.id };
}

const countOf = (evs: { type: string }[], type: string) => evs.filter((e) => e.type === type).length;

test("branchNameFor / slugify build the task-<key>-<slug> convention", () => {
  assert.equal(branchNameFor("TASK-014", "Event log table"), "task-014-event-log-table");
  assert.equal(slugify("Make it FAST -- now!"), "make-it-fast-now");
});

test("claimTask atomically claims; a second claimer loses", async () => {
  const { db, close } = await createTestDb();
  try {
    const { taskId, u1, u2, projectId } = await seed(db);
    const r1 = await claimTask(db, taskId, u1);
    assert.equal(r1.claimed, true);
    assert.equal(r1.branchName, "task-014-event-log-table");

    const t = (await db.select().from(tasks).where(eq(tasks.id, taskId)))[0];
    assert.equal(t.claimState, "claimed");
    assert.equal(t.claimUserId, u1);
    assert.equal(t.branchName, "task-014-event-log-table");
    const claimedEvs = await db.select().from(events).where(eq(events.type, "task.claimed"));
    assert.equal(claimedEvs.length, 1);
    assert.equal(claimedEvs[0].projectId, projectId, "task.claimed event carries projectId");

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
    const { taskId, u1, u2, projectId } = await seed(db);
    await claimTask(db, taskId, u1);

    await assert.rejects(unclaimTask(db, taskId, u2), /only the claimer/i);

    const r = await unclaimTask(db, taskId, u1);
    assert.equal(r.unclaimed, true);
    const t = (await db.select().from(tasks).where(eq(tasks.id, taskId)))[0];
    assert.equal(t.claimState, "unclaimed");
    assert.equal(t.claimUserId, null);
    assert.equal(t.branchName, null);
    const unclaimedEvs = await db.select().from(events).where(eq(events.type, "task.unclaimed"));
    assert.equal(unclaimedEvs.length, 1);
    assert.equal(unclaimedEvs[0].projectId, projectId, "task.unclaimed event carries projectId");
  } finally {
    await close();
  }
});

test("unclaimTask resets branchCreatedAt to null", async () => {
  const { db, close } = await createTestDb();
  try {
    const [proj] = await db
      .insert(project)
      .values({ repoFullName: "acme/repo", defaultBranch: "main", installationId: 1, localClonePath: "/x" })
      .returning({ id: project.id });
    const u = await db.insert(users).values({ githubId: 1, githubLogin: "alice" }).returning({ id: users.id });
    const [req] = await db
      .insert(requirements)
      .values({ key: "REQ-001", title: "t", description: "d", provenance: "imported", projectId: proj.id })
      .returning({ id: requirements.id });
    const [task] = await db
      .insert(tasks)
      .values({ key: "TASK-001", title: "a", body: "b", requirementId: req.id, effort: 1, risk: "low", confidence: 50, projectId: proj.id })
      .returning({ id: tasks.id });

    await claimTask(db, task.id, u[0].id);
    // simulate the branch having been created
    await db.update(tasks).set({ branchCreatedAt: new Date() }).where(eq(tasks.id, task.id));

    await unclaimTask(db, task.id, u[0].id);

    const [t] = await db.select({ b: tasks.branchCreatedAt }).from(tasks).where(eq(tasks.id, task.id));
    assert.equal(t.b, null);
  } finally {
    await close();
  }
});
