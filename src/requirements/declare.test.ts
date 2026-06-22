// src/requirements/declare.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { createTestDb } from "../db/client";
import { requirements, events, project } from "../db/schema";
import { eq } from "drizzle-orm";
import { declareRequirement } from "./declare";

async function seedProject(db: Awaited<ReturnType<typeof createTestDb>>["db"]): Promise<string> {
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

test("declareRequirement mints REQ-001 on an empty table and emits requirement.declared", async () => {
  const { db, close } = await createTestDb();
  try {
    const projectId = await seedProject(db);
    const r = await declareRequirement(db, { title: "Overview dashboard", description: "d", provenance: "drift", why: "because", projectId });
    assert.equal(r.key, "REQ-001");

    const [row] = await db.select().from(requirements).where(eq(requirements.id, r.id));
    assert.equal(row.key, "REQ-001");
    assert.equal(row.provenance, "drift");
    assert.equal(row.status, "planned");

    const evs = await db.select().from(events).where(eq(events.subjectId, r.id));
    assert.equal(evs.length, 1);
    assert.equal(evs[0].type, "requirement.declared");
    assert.equal(evs[0].rationale, "because");
  } finally {
    await close();
  }
});

test("declareRequirement sets projectId on row and event when passed explicitly", async () => {
  const { db, close } = await createTestDb();
  try {
    const projectId = await seedProject(db);
    const r = await declareRequirement(db, {
      title: "Scoped req",
      provenance: "imported",
      projectId,
    });

    const [row] = await db.select().from(requirements).where(eq(requirements.id, r.id));
    assert.equal(row.projectId, projectId, "requirement.project_id should match");

    const [ev] = await db.select().from(events).where(eq(events.subjectId, r.id));
    assert.equal(ev.projectId, projectId, "event.project_id should match");
  } finally {
    await close();
  }
});

test("declareRequirement resolves oldest project when projectId omitted", async () => {
  const { db, close } = await createTestDb();
  try {
    const projectId = await seedProject(db);
    // No projectId passed — should fall back to the oldest project.
    const r = await declareRequirement(db, { title: "Auto-scoped", provenance: "drift" });

    const [row] = await db.select().from(requirements).where(eq(requirements.id, r.id));
    assert.equal(row.projectId, projectId, "should resolve to the sole project");

    const [ev] = await db.select().from(events).where(eq(events.subjectId, r.id));
    assert.equal(ev.projectId, projectId, "event should carry resolved projectId");
  } finally {
    await close();
  }
});

test("declareRequirement uses max existing number + 1, not the count", async () => {
  const { db, close } = await createTestDb();
  try {
    const projectId = await seedProject(db);
    await db.insert(requirements).values([
      { key: "REQ-001", title: "a", description: "", provenance: "imported", projectId },
      { key: "REQ-005", title: "b", description: "", provenance: "imported", projectId }, // gap
    ]);
    const r = await declareRequirement(db, { title: "next", provenance: "drift", projectId });
    assert.equal(r.key, "REQ-006");
  } finally {
    await close();
  }
});
