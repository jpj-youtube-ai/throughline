import test from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { createTestDb, type Db } from "../db/client";
import { users, ideas, requirements, tasks, events, project } from "../db/schema";
import { persistGeneration } from "./persist";
import type { GenerationOutput } from "../schema";

const OUTPUT: GenerationOutput = {
  new_requirements: [{ key: "REQ-028", title: "New capability", description: "a new capability" }],
  tasks: [
    {
      title: "Build the event log",
      requirement_key: "REQ-003",
      body: { pointers: ["follow x", "follow y"], acceptance_check: "tests pass" },
      effort: 3,
      risk: "med",
      confidence: 75,
    },
    {
      title: "Build the new capability",
      requirement_key: "REQ-028",
      body: { pointers: ["new file"], acceptance_check: "it works" },
      effort: 2,
      risk: "low",
      confidence: 60,
    },
  ],
};

async function seedApprovedIdea(db: Db): Promise<string> {
  const [author] = await db.insert(users).values({ githubId: 1, githubLogin: "alice" }).returning({ id: users.id });
  // REQ-027 makes the max 27, so a suggested REQ-028 mints as REQ-028 (like the
  // real genesis spec). REQ-003 is the existing requirement a task links to.
  await db.insert(requirements).values([
    { key: "REQ-001", title: "Sign-in", description: "d", provenance: "imported" },
    { key: "REQ-003", title: "Event log", description: "d", provenance: "imported" },
    { key: "REQ-027", title: "Why-quality", description: "d", provenance: "imported" },
  ]);
  const [idea] = await db
    .insert(ideas)
    .values({ title: "X", why: "w", authorId: author.id, state: "approved" })
    .returning({ id: ideas.id });
  return idea.id;
}

async function seedProject(db: Db): Promise<string> {
  const [p] = await db
    .insert(project)
    .values({
      repoFullName: "acme/throughline",
      defaultBranch: "main",
      installationId: 42,
      localClonePath: "/tmp/repo",
      specPath: "SPEC.md",
      claudeMdPath: "CLAUDE.md",
    })
    .returning({ id: project.id });
  return p.id;
}

const typeCounts = (evs: { type: string }[]) =>
  evs.reduce<Record<string, number>>((a, e) => ((a[e.type] = (a[e.type] ?? 0) + 1), a), {});

test("persistGeneration mints keys, links reqs, emits tasks.generated, marks idea generated", async () => {
  const { db, close } = await createTestDb();
  try {
    const ideaId = await seedApprovedIdea(db);
    const res = await persistGeneration(db, {
      ideaId,
      output: OUTPUT,
      model: "claude-opus-4-8",
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    assert.deepEqual(res.newRequirementKeys, ["REQ-028"]);
    assert.deepEqual(res.taskKeys, ["TASK-001", "TASK-002"]);

    const newReq = (await db.select().from(requirements).where(eq(requirements.key, "REQ-028")))[0];
    assert.equal(newReq.provenance, "voted");
    // Declared planned, then advanced to building in the same tx because it
    // received TASK-002 (REQ-021 lifecycle).
    assert.equal(newReq.status, "building");
    assert.equal(newReq.originIdeaId, ideaId);
    // REQ-003 also got a task (TASK-001), so it is building too.
    assert.equal((await db.select().from(requirements).where(eq(requirements.key, "REQ-003")))[0].status, "building");

    const allReqs = await db.select().from(requirements);
    const reqKeyById = new Map(allReqs.map((r) => [r.id, r.key]));
    const t = await db.select().from(tasks);
    assert.equal(t.length, 2);
    const byKey = new Map(t.map((x) => [x.key, x]));
    assert.equal(reqKeyById.get(byKey.get("TASK-001")!.requirementId), "REQ-003");
    assert.equal(reqKeyById.get(byKey.get("TASK-002")!.requirementId), "REQ-028");
    assert.equal(byKey.get("TASK-001")!.effort, 3);
    assert.equal(byKey.get("TASK-001")!.risk, "med");
    assert.equal(byKey.get("TASK-001")!.claimState, "unclaimed");
    assert.equal(byKey.get("TASK-001")!.githubStatus, "open");
    assert.match(byKey.get("TASK-001")!.body, /Pointers/);
    assert.match(byKey.get("TASK-001")!.body, /Acceptance check/);

    const evs = await db.select().from(events);
    const counts = typeCounts(evs);
    assert.equal(counts["requirement.declared"], 1);
    assert.equal(counts["tasks.generated"], 1);
    const gen = evs.find((e) => e.type === "tasks.generated")!;
    const payload = gen.payload as { task_keys: string[]; req_keys: string[]; model: string };
    assert.deepEqual(payload.task_keys, ["TASK-001", "TASK-002"]);
    assert.deepEqual(payload.req_keys, ["REQ-028"]);
    assert.equal(payload.model, "claude-opus-4-8");

    assert.equal((await db.select().from(ideas).where(eq(ideas.id, ideaId)))[0].state, "generated");
  } finally {
    await close();
  }
});

test("persistGeneration re-mints a suggested REQ key past existing ones", async () => {
  const { db, close } = await createTestDb();
  try {
    const ideaId = await seedApprovedIdea(db);
    // A REQ-028 already exists, so the suggested REQ-028 must become REQ-029.
    await db.insert(requirements).values({ key: "REQ-028", title: "existing", description: "d", provenance: "voted" });

    const res = await persistGeneration(db, { ideaId, output: OUTPUT, model: "m", usage: null });
    assert.deepEqual(res.newRequirementKeys, ["REQ-029"]);

    const allReqs = await db.select().from(requirements);
    const reqKeyById = new Map(allReqs.map((r) => [r.id, r.key]));
    const t = await db.select().from(tasks);
    const byKey = new Map(t.map((x) => [x.key, x]));
    // The task that suggested REQ-028 links to the minted REQ-029.
    assert.equal(reqKeyById.get(byKey.get("TASK-002")!.requirementId), "REQ-029");
  } finally {
    await close();
  }
});

test("persistGeneration refuses an idea that is not approved (no partial tasks)", async () => {
  const { db, close } = await createTestDb();
  try {
    const [author] = await db.insert(users).values({ githubId: 1, githubLogin: "alice" }).returning({ id: users.id });
    const [idea] = await db
      .insert(ideas)
      .values({ title: "X", why: "w", authorId: author.id, state: "voting" })
      .returning({ id: ideas.id });
    await assert.rejects(
      persistGeneration(db, { ideaId: idea.id, output: OUTPUT, model: "m", usage: null }),
      /not approved/i,
    );
    assert.equal((await db.select().from(tasks)).length, 0, "no partial tasks written");
  } finally {
    await close();
  }
});

test("persistGeneration sets tasks.projectId from idea.projectId and numbers TASK-NNN within the project", async () => {
  const { db, close } = await createTestDb();
  try {
    const projectId = await seedProject(db);
    const [author] = await db.insert(users).values({ githubId: 2, githubLogin: "bob" }).returning({ id: users.id });
    await db.insert(requirements).values([
      { key: "REQ-001", title: "Sign-in", description: "d", provenance: "imported", projectId },
      { key: "REQ-003", title: "Event log", description: "d", provenance: "imported", projectId },
      { key: "REQ-027", title: "Why-quality", description: "d", provenance: "imported", projectId },
    ]);
    // Seed a task in a DIFFERENT project (no projectId) to ensure numbering is isolated.
    await db.insert(requirements).values({ key: "REQ-099", title: "Other", description: "d", provenance: "imported" });
    const [idea] = await db
      .insert(ideas)
      .values({ title: "Scoped idea", why: "w", authorId: author.id, state: "approved", projectId })
      .returning({ id: ideas.id });

    const res = await persistGeneration(db, { ideaId: idea.id, output: OUTPUT, model: "m", usage: null });
    // Even though TASK-NNN would be higher if counting all tasks, it scopes to projectId
    assert.deepEqual(res.taskKeys, ["TASK-001", "TASK-002"]);

    const allTasks = await db.select().from(tasks);
    for (const t of allTasks) {
      assert.equal(t.projectId, projectId, `task ${t.key} should carry projectId`);
    }

    // New requirements minted in this run should also carry projectId
    const newReq = (await db.select().from(requirements).where(eq(requirements.key, res.newRequirementKeys[0])))[0];
    assert.equal(newReq.projectId, projectId, "minted requirement should carry projectId");

    // Events should carry projectId
    const evs = await db.select().from(events);
    const genEvent = evs.find((e) => e.type === "tasks.generated");
    assert.ok(genEvent, "tasks.generated event present");
    assert.equal(genEvent!.projectId, projectId, "tasks.generated event should carry projectId");
  } finally {
    await close();
  }
});
