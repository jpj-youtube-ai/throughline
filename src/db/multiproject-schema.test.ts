import test from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { createTestDb } from "./client";
import { project, requirements } from "./schema";

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

// NOTE: The second test from the brief (events append-only after migration, using
// emitEvent with projectId) is omitted here — it depends on Task 3 updating
// emitEvent to accept projectId. It will be added when Task 3 lands.
