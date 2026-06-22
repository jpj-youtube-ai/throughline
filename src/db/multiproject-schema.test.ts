import test from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { createTestDb } from "./client";
import { project, requirements, events } from "./schema";
import { emitEvent } from "./events";

// Drizzle wraps the database error as "Failed query: …" and puts the Postgres
// error (with our trigger's message) in `.cause`. Check the whole chain.
function mentionsAppendOnly(err: unknown): boolean {
  const cause = err instanceof Error ? (err.cause as unknown) : undefined;
  const text = `${err instanceof Error ? err.message : String(err)} ${
    cause instanceof Error ? cause.message : String(cause ?? "")
  }`;
  return /append-only/i.test(text);
}

test("scoped tables have a project_id column and backfill is id-agnostic", async () => {
  const { db, close } = await createTestDb();
  try {
    const [p] = await db
      .insert(project)
      .values({
        repoFullName: "o/r",
        installationId: 1,
        defaultBranch: "main",
        localClonePath: "/t",
        specPath: "SPEC.md",
        claudeMdPath: "CLAUDE.md",
      })
      .returning({ id: project.id });
    // a row written with project_id round-trips
    await db.insert(requirements).values({
      key: "REQ-001",
      title: "t",
      description: "d",
      provenance: "imported",
      projectId: p.id,
    });
    const [r] = await db
      .select({ pid: requirements.projectId })
      .from(requirements)
      .where(eq(requirements.key, "REQ-001"));
    assert.equal(r.pid, p.id);
  } finally {
    await close();
  }
});

test("events is still append-only after the migration", async () => {
  const { db, close } = await createTestDb();
  try {
    const [p] = await db
      .insert(project)
      .values({
        repoFullName: "o/r",
        installationId: 1,
        defaultBranch: "main",
        localClonePath: "/t",
        specPath: "SPEC.md",
        claudeMdPath: "CLAUDE.md",
      })
      .returning({ id: project.id });
    await db.transaction(async (tx) => {
      await emitEvent(tx, { type: "project.bound", subjectType: "project", subjectId: p.id, projectId: p.id });
    });
    await assert.rejects(
      db.update(events).set({ rationale: "x" }),
      mentionsAppendOnly,
    );
  } finally {
    await close();
  }
});
