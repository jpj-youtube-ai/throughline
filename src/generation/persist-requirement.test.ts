// src/generation/persist-requirement.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { createTestDb } from "../db/client";
import { requirements, tasks, events } from "../db/schema";
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
    })),
  };
}

test("persistGenerationForRequirement links all tasks to the requirement, emits the event, and advances it to building", async () => {
  const { db, close } = await createTestDb();
  try {
    const [r] = await db
      .insert(requirements)
      .values({ key: "REQ-005", title: "Search", description: "d", provenance: "imported" })
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
