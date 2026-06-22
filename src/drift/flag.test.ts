import test from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { createTestDb, type Db } from "../db/client";
import { users, requirements, tasks, driftFlags, events, project } from "../db/schema";
import { flagDrift, resolveDrift } from "./flag";

interface Seed {
  taskId: string;
  reqBId: string;
  userId: string;
  projectId: string;
}

async function seed(db: Db): Promise<Seed> {
  const [proj] = await db
    .insert(project)
    .values({ repoFullName: "acme/repo", defaultBranch: "main", installationId: 1, localClonePath: "/x" })
    .returning({ id: project.id });
  const [user] = await db.insert(users).values({ githubId: 1, githubLogin: "alice" }).returning({ id: users.id });
  const [reqA] = await db
    .insert(requirements)
    .values({ key: "REQ-003", title: "Event log", description: "d", provenance: "imported", projectId: proj.id })
    .returning({ id: requirements.id });
  const [reqB] = await db
    .insert(requirements)
    .values({ key: "REQ-005", title: "Submit idea", description: "d", provenance: "imported", projectId: proj.id })
    .returning({ id: requirements.id });
  const [task] = await db
    .insert(tasks)
    .values({ key: "TASK-001", title: "t", body: "b", requirementId: reqA.id, effort: 1, risk: "low", confidence: 50, projectId: proj.id })
    .returning({ id: tasks.id });
  return { taskId: task.id, reqBId: reqB.id, userId: user.id, projectId: proj.id };
}

async function flag(db: Db, taskId: string): Promise<string> {
  const f = await flagDrift(db, { taskId, prNumber: 7, unmappedItems: ["added a billing module"] });
  return f!.id;
}

test("flagDrift records an open flag + drift.flagged; empty items -> no flag", async () => {
  const { db, close } = await createTestDb();
  try {
    const { taskId, projectId } = await seed(db);
    assert.equal(await flagDrift(db, { taskId, prNumber: 7, unmappedItems: [] }), null);

    const f = await flagDrift(db, { taskId, prNumber: 7, unmappedItems: ["added a billing module"] });
    assert.ok(f?.id);
    const flags = await db.select().from(driftFlags);
    assert.equal(flags.length, 1);
    assert.equal(flags[0].status, "open");
    assert.equal(flags[0].prNumber, 7);
    const flaggedEvs = await db.select().from(events).where(eq(events.type, "drift.flagged"));
    assert.equal(flaggedEvs.length, 1);
    assert.equal(flaggedEvs[0].projectId, projectId, "drift.flagged event carries projectId");
  } finally {
    await close();
  }
});

test("resolveDrift out_of_scope records the decision + why; rationale is required", async () => {
  const { db, close } = await createTestDb();
  try {
    const { taskId, userId } = await seed(db);
    const flagId = await flag(db, taskId);

    await assert.rejects(
      resolveDrift(db, { flagId, resolution: "out_of_scope", resolvedBy: userId, rationale: "   " }),
      /rationale/i,
    );

    const r = await resolveDrift(db, {
      flagId,
      resolution: "out_of_scope",
      resolvedBy: userId,
      rationale: "will revert in a follow-up PR",
    });
    assert.equal(r.resolution, "out_of_scope");
    const flagRow = (await db.select().from(driftFlags))[0];
    assert.equal(flagRow.status, "resolved");
    assert.equal(flagRow.resolution, "out_of_scope");
    assert.equal(flagRow.resolvedBy, userId);
    const resolved = await db.select().from(events).where(eq(events.type, "drift.resolved"));
    assert.equal(resolved.length, 1);
    assert.match(resolved[0].rationale ?? "", /follow-up/);
  } finally {
    await close();
  }
});

test("resolveDrift new_req mints a provenance=drift requirement", async () => {
  const { db, close } = await createTestDb();
  try {
    const { taskId, userId } = await seed(db); // existing reqs max at REQ-005
    const flagId = await flag(db, taskId);

    const r = await resolveDrift(db, {
      flagId,
      resolution: "new_req",
      resolvedBy: userId,
      rationale: "billing is its own concern",
      newReqTitle: "Billing",
    });
    assert.equal(r.newReqKey, "REQ-006");
    const req = (await db.select().from(requirements).where(eq(requirements.key, "REQ-006")))[0];
    assert.equal(req.provenance, "drift");
    assert.equal(req.status, "planned");
    assert.equal((await db.select().from(events).where(eq(events.type, "requirement.declared"))).length, 1);
  } finally {
    await close();
  }
});

test("resolveDrift relink repoints the task to a different requirement", async () => {
  const { db, close } = await createTestDb();
  try {
    const { taskId, reqBId, userId } = await seed(db);
    const flagId = await flag(db, taskId);

    await resolveDrift(db, {
      flagId,
      resolution: "relink",
      resolvedBy: userId,
      rationale: "this work belongs to REQ-005",
      relinkReqKey: "REQ-005",
    });
    assert.equal((await db.select().from(tasks).where(eq(tasks.id, taskId)))[0].requirementId, reqBId);
  } finally {
    await close();
  }
});

test("resolving an already-resolved flag is rejected", async () => {
  const { db, close } = await createTestDb();
  try {
    const { taskId, userId } = await seed(db);
    const flagId = await flag(db, taskId);
    await resolveDrift(db, { flagId, resolution: "out_of_scope", resolvedBy: userId, rationale: "ok" });
    await assert.rejects(
      resolveDrift(db, { flagId, resolution: "out_of_scope", resolvedBy: userId, rationale: "again" }),
      /already resolved/i,
    );
  } finally {
    await close();
  }
});
