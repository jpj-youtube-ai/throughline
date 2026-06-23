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

test("REQ/TASK keys are unique per project, not globally", async () => {
  const { db, close } = await createTestDb();
  try {
    const [a] = await db.insert(project).values({ repoFullName: "o/a", installationId: 1, defaultBranch: "main", localClonePath: "/a", specPath: "SPEC.md", claudeMdPath: "CLAUDE.md" }).returning({ id: project.id });
    const [b] = await db.insert(project).values({ repoFullName: "o/b", installationId: 2, defaultBranch: "main", localClonePath: "/b", specPath: "SPEC.md", claudeMdPath: "CLAUDE.md" }).returning({ id: project.id });
    await db.insert(requirements).values({ key: "REQ-001", title: "t", description: "d", provenance: "imported", projectId: a.id });
    await db.insert(requirements).values({ key: "REQ-001", title: "t2", description: "d", provenance: "imported", projectId: b.id }); // ok: different project
    await assert.rejects(() => db.insert(requirements).values({ key: "REQ-001", title: "dup", description: "d", provenance: "imported", projectId: a.id })); // dup within project
  } finally { await close(); }
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

test("project.context_pins defaults to empty and round-trips", async () => {
  const { db, close } = await createTestDb();
  try {
    const [p] = await db
      .insert(project)
      .values({ repoFullName: "o/r", installationId: 1, defaultBranch: "main", localClonePath: "/t", specPath: "SPEC.md", claudeMdPath: "CLAUDE.md" })
      .returning({ id: project.id, contextPins: project.contextPins });
    assert.deepEqual(p.contextPins, []);
    await db.update(project).set({ contextPins: ["src/db/events.ts"] }).where(eq(project.id, p.id));
    const [r] = await db.select({ contextPins: project.contextPins }).from(project).where(eq(project.id, p.id));
    assert.deepEqual(r.contextPins, ["src/db/events.ts"]);
  } finally {
    await close();
  }
});
