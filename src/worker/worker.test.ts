import test from "node:test";
import assert from "node:assert/strict";
import { createTestDb, type Db } from "../db/client";
import { users, ideas, project } from "../db/schema";
import { tick, type WorkerDeps } from "./index";

async function makeUser(db: Db): Promise<string> {
  const [u] = await db
    .insert(users)
    .values({ githubId: 1, githubLogin: "testuser" })
    .returning({ id: users.id });
  return u.id;
}

async function seedProject(db: Db, repoFullName: string): Promise<string> {
  const [p] = await db
    .insert(project)
    .values({ repoFullName, defaultBranch: "main", installationId: 1, localClonePath: "/tmp/repo" })
    .returning({ id: project.id });
  return p.id;
}

async function seedApprovedIdea(db: Db, projId: string, authorId: string, title: string): Promise<string> {
  const [i] = await db
    .insert(ideas)
    .values({ title, why: "test", state: "approved", projectId: projId, authorId })
    .returning({ id: ideas.id });
  return i.id;
}

test("tick iterates all projects: approved ideas from each project are generated", async () => {
  const { db, close } = await createTestDb();
  try {
    const userId = await makeUser(db);
    const projAId = await seedProject(db, "acme/repo-a");
    const projBId = await seedProject(db, "acme/repo-b");

    const ideaAId = await seedApprovedIdea(db, projAId, userId, "Idea for project A");
    const ideaBId = await seedApprovedIdea(db, projBId, userId, "Idea for project B");

    const generated: Array<{ db: Db; ideaId: string }> = [];
    const deps: WorkerDeps = {
      refreshClone: async () => {},
      generate: async (d, ideaId) => {
        generated.push({ db: d, ideaId });
        return { ok: true, taskKeys: ["TASK-001"] };
      },
      createIssues: async () => ({ created: [] }),
      createBranches: async () => ({ created: [] }),
      closeIssues: async () => ({ closed: [] }),
      specMaterialize: async () => ({ status: "already-materialized" as const, requirementCount: 0 }),
      regenNarrative: async () => ({ regenerated: false }),
      digest: async () => ({ generated: false, reason: "nothing new" }),
    };

    await tick(db, deps);

    assert.equal(generated.length, 2, "generate should be called once per approved idea across all projects");
    const generatedIds = generated.map((g) => g.ideaId);
    assert.ok(generatedIds.includes(ideaAId), "idea from project A should be generated");
    assert.ok(generatedIds.includes(ideaBId), "idea from project B should be generated");
  } finally {
    await close();
  }
});

test("tick scopes approved-idea query per project: an idea from project A is not picked up in project B's turn", async () => {
  const { db, close } = await createTestDb();
  try {
    const userId = await makeUser(db);
    const projAId = await seedProject(db, "acme/repo-a");
    const projBId = await seedProject(db, "acme/repo-b");

    // Only project A has an approved idea.
    const ideaAId = await seedApprovedIdea(db, projAId, userId, "Only A has an idea");
    // Project B has none.
    void projBId;

    const generatedForProject: Array<{ projId: string; ideaId: string }> = [];

    // Track which project's turn leads to which generate call by wrapping tick differently.
    // Since tick iterates projects in order, we spy on the generate calls and match ideaId
    // against the DB to confirm the idea belongs to projA (not projB).
    const deps: WorkerDeps = {
      refreshClone: async () => {},
      generate: async (d, ideaId) => {
        // Verify the idea belongs to project A
        const [idea] = await d.select({ projectId: ideas.projectId }).from(ideas).where(
          (await import("drizzle-orm")).eq(ideas.id, ideaId),
        );
        generatedForProject.push({ projId: idea.projectId, ideaId });
        return { ok: true, taskKeys: [] };
      },
      createIssues: async () => ({ created: [] }),
      createBranches: async () => ({ created: [] }),
      closeIssues: async () => ({ closed: [] }),
      specMaterialize: async () => ({ status: "already-materialized" as const, requirementCount: 0 }),
      regenNarrative: async () => ({ regenerated: false }),
      digest: async () => ({ generated: false, reason: "nothing new" }),
    };

    await tick(db, deps);

    assert.equal(generatedForProject.length, 1, "only one idea should be generated");
    assert.equal(generatedForProject[0].ideaId, ideaAId);
    assert.equal(generatedForProject[0].projId, projAId, "the idea belongs to project A");
  } finally {
    await close();
  }
});

test("tick per-project: a step failure in one project does not abort processing of the next project", async () => {
  const { db, close } = await createTestDb();
  try {
    const userId = await makeUser(db);
    const projAId = await seedProject(db, "acme/repo-a");
    const projBId = await seedProject(db, "acme/repo-b");

    await seedApprovedIdea(db, projAId, userId, "Idea A");
    await seedApprovedIdea(db, projBId, userId, "Idea B");

    const processed: string[] = [];
    let firstCall = true;

    const deps: WorkerDeps = {
      refreshClone: async () => {},
      generate: async (_d, ideaId) => {
        if (firstCall) {
          firstCall = false;
          throw new Error("simulated generation failure for first idea");
        }
        processed.push(ideaId);
        return { ok: true, taskKeys: [] };
      },
      createIssues: async () => ({ created: [] }),
      createBranches: async () => ({ created: [] }),
      closeIssues: async () => ({ closed: [] }),
      specMaterialize: async () => ({ status: "already-materialized" as const, requirementCount: 0 }),
      regenNarrative: async () => ({ regenerated: false }),
      digest: async () => ({ generated: false, reason: "nothing new" }),
    };

    // Should not throw — failures are caught per step.
    await assert.doesNotReject(() => tick(db, deps));

    // The second idea (in the other project) should still be processed.
    assert.equal(processed.length, 1, "second idea still processed despite first failing");
  } finally {
    await close();
  }
});

test("tick runs the close-issues sweep per project, and a failure in it does not abort the tick", async () => {
  const { db, close } = await createTestDb();
  try {
    const userId = await makeUser(db);
    const projAId = await seedProject(db, "acme/repo-a");
    await seedApprovedIdea(db, projAId, userId, "Idea A");

    const closeCalls: string[] = [];
    const deps: WorkerDeps = {
      refreshClone: async () => {},
      generate: async () => ({ ok: true, taskKeys: [] }),
      createIssues: async () => ({ created: [] }),
      createBranches: async () => ({ created: [] }),
      closeIssues: async (_d, pid) => {
        closeCalls.push(pid);
        throw new Error("close boom");
      },
      specMaterialize: async () => ({ status: "already-materialized" as const, requirementCount: 0 }),
      regenNarrative: async () => ({ regenerated: false }),
      digest: async () => ({ generated: false, reason: "nothing new" }),
    };

    // The thrown error from closeIssues must be caught inside the step.
    await assert.doesNotReject(() => tick(db, deps));
    assert.deepEqual(closeCalls, [projAId], "close sweep invoked for the project");
  } finally {
    await close();
  }
});

test("tick refreshes each project's clone before generating; a refresh failure does not abort the tick", async () => {
  const { db, close } = await createTestDb();
  try {
    const userId = await makeUser(db);
    const projAId = await seedProject(db, "acme/repo-a");
    await seedApprovedIdea(db, projAId, userId, "Idea A");

    const order: string[] = [];
    const deps: WorkerDeps = {
      refreshClone: async (_d, pid) => {
        order.push(`refresh:${pid}`);
        throw new Error("pull boom");
      },
      generate: async () => {
        order.push("generate");
        return { ok: true, taskKeys: [] };
      },
      createIssues: async () => ({ created: [] }),
      createBranches: async () => ({ created: [] }),
      closeIssues: async () => ({ closed: [] }),
      specMaterialize: async () => ({ status: "already-materialized" as const, requirementCount: 0 }),
      regenNarrative: async () => ({ regenerated: false }),
      digest: async () => ({ generated: false, reason: "nothing new" }),
    };

    await assert.doesNotReject(() => tick(db, deps));
    assert.deepEqual(order, [`refresh:${projAId}`, "generate"], "refresh runs before generation; its failure is isolated");
  } finally {
    await close();
  }
});

test("tick materializes every project each tick, even when nothing was generated", async () => {
  const { db, close } = await createTestDb();
  try {
    const projAId = await seedProject(db, "acme/repo-a"); // no approved ideas → no generation
    const materializeCalls: string[] = [];
    const deps: WorkerDeps = {
      refreshClone: async () => {},
      generate: async () => ({ ok: true, taskKeys: [] }),
      createIssues: async () => ({ created: [] }),
      createBranches: async () => ({ created: [] }),
      closeIssues: async () => ({ closed: [] }),
      specMaterialize: async (_d, pid) => { materializeCalls.push(pid); return { status: "already-materialized" as const, requirementCount: 0 }; },
      regenNarrative: async () => ({ regenerated: false }),
      digest: async () => ({ generated: false, reason: "nothing new" }),
    };
    await tick(db, deps);
    assert.deepEqual(materializeCalls, [projAId], "materialize runs each tick regardless of generation");
  } finally { await close(); }
});

test("tick regenerates a project's narrative only when requested", async () => {
  const { db, close } = await createTestDb();
  try {
    const projAId = await seedProject(db, "acme/repo-a");
    const calls: string[] = [];
    const deps: WorkerDeps = {
      refreshClone: async () => {},
      generate: async () => ({ ok: true, taskKeys: [] }),
      createIssues: async () => ({ created: [] }),
      createBranches: async () => ({ created: [] }),
      closeIssues: async () => ({ closed: [] }),
      specMaterialize: async () => ({ status: "already-materialized", requirementCount: 0 }),
      regenNarrative: async (_d, pid) => { calls.push(pid); return { regenerated: false }; },
      digest: async () => ({ generated: false, reason: "nothing new" }),
    };
    await tick(db, deps);
    assert.deepEqual(calls, [projAId]);
  } finally { await close(); }
});

