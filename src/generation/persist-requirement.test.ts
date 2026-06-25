// src/generation/persist-requirement.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { createTestDb } from "../db/client";
import { requirements, tasks, events, project } from "../db/schema";
import { persistGenerationForRequirement } from "./persist";
import type { GenerationOutput } from "../schema";

function output(n: number): GenerationOutput {
  return {
    new_requirements: [],
    tasks: Array.from({ length: n }, (_, i) => ({
      title: `Task ${i + 1}`,
      requirement_key: "REQ-999", // ignored — forced to the target requirement
      body: { pointers: ["src/foo.ts"], acceptance_check: "it works" },
      effort: 2,
      risk: "low" as const,
      confidence: 80,
      prototypes: [] as string[],
    })),
  };
}

test("persistGenerationForRequirement links all tasks to the requirement, emits the event, and advances it to building", async () => {
  const { db, close } = await createTestDb();
  try {
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

    const [r] = await db
      .insert(requirements)
      .values({ key: "REQ-005", title: "Search", description: "d", provenance: "imported", projectId: p.id })
      .returning({ id: requirements.id });

    const { taskKeys } = await persistGenerationForRequirement(db, {
      reqId: r.id,
      output: output(2),
      model: "claude-opus-4-8",
      usage: { input_tokens: 10, output_tokens: 20 },
    });
    assert.deepEqual(taskKeys, ["TASK-001", "TASK-002"]);

    const rows = await db.select().from(tasks).where(eq(tasks.requirementId, r.id));
    assert.equal(rows.length, 2);
    assert.ok(rows.every((t) => t.requirementId === r.id)); // forced link
    assert.equal(rows[0].originIdeaId, null); // no idea

    const evs = await db.select().from(events).where(eq(events.subjectId, r.id));
    const gen = evs.find((e) => e.type === "tasks.generated");
    assert.ok(gen, "tasks.generated emitted");
    assert.equal(gen!.subjectType, "requirement");

    const [req] = await db.select({ status: requirements.status }).from(requirements).where(eq(requirements.id, r.id));
    assert.equal(req.status, "building"); // planned -> building

    await assert.rejects(
      () => persistGenerationForRequirement(db, { reqId: r.id, output: output(1), model: "m", usage: null }),
      /already has tasks/,
    );
  } finally {
    await close();
  }
});

test("persistGenerationForRequirement sets tasks.projectId from requirement.projectId and numbers within the project", async () => {
  const { db, close } = await createTestDb();
  try {
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
    const projectId = p.id;

    // Seed a second project and a task in it to pollute the global count
    const [otherProj] = await db
      .insert(project)
      .values({
        repoFullName: "other/repo",
        defaultBranch: "main",
        installationId: 43,
        localClonePath: "/tmp/other",
        specPath: "SPEC.md",
        claudeMdPath: "CLAUDE.md",
      })
      .returning({ id: project.id });
    const [otherReq] = await db
      .insert(requirements)
      .values({ key: "REQ-099", title: "Other", description: "d", provenance: "imported", projectId: otherProj.id })
      .returning({ id: requirements.id });
    await db.insert(tasks).values({
      key: "TASK-010",
      title: "existing task",
      body: "body",
      requirementId: otherReq.id,
      effort: 1,
      risk: "low",
      confidence: 80,
      projectId: otherProj.id,
    });

    const [r] = await db
      .insert(requirements)
      .values({ key: "REQ-005", title: "Search", description: "d", provenance: "imported", projectId })
      .returning({ id: requirements.id });

    const { taskKeys } = await persistGenerationForRequirement(db, {
      reqId: r.id,
      output: output(2),
      model: "claude-opus-4-8",
      usage: { input_tokens: 10, output_tokens: 20 },
    });
    // Should start at TASK-001 within the project (TASK-010 is in a different project)
    assert.deepEqual(taskKeys, ["TASK-001", "TASK-002"]);

    const rows = await db.select().from(tasks).where(eq(tasks.requirementId, r.id));
    for (const t of rows) {
      assert.equal(t.projectId, projectId, `task ${t.key} should carry projectId`);
    }

    const ev = (await db.select().from(events).where(eq(events.subjectId, r.id))).find((e) => e.type === "tasks.generated");
    assert.ok(ev, "tasks.generated event present");
    assert.equal(ev!.projectId, projectId, "event should carry projectId");
  } finally {
    await close();
  }
});
