// src/requirements/keys.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { createTestDb } from "../db/client";
import { requirements, project } from "../db/schema";
import { nextRequirementKey } from "./keys";

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

test("nextRequirementKey mints REQ-001 for an empty project", async () => {
  const { db, close } = await createTestDb();
  try {
    const projectId = await seedProject(db);
    const key = await db.transaction((tx) => nextRequirementKey(tx, projectId));
    assert.equal(key, "REQ-001");
  } finally {
    await close();
  }
});

test("nextRequirementKey counts within project — two projects each start at REQ-001 independently", async () => {
  const { db, close } = await createTestDb();
  try {
    const [p1] = await db
      .insert(project)
      .values({
        repoFullName: "acme/alpha",
        defaultBranch: "main",
        installationId: 1,
        localClonePath: "/tmp/alpha",
        specPath: "SPEC.md",
        claudeMdPath: "CLAUDE.md",
      })
      .returning({ id: project.id });
    const [p2] = await db
      .insert(project)
      .values({
        repoFullName: "acme/beta",
        defaultBranch: "main",
        installationId: 2,
        localClonePath: "/tmp/beta",
        specPath: "SPEC.md",
        claudeMdPath: "CLAUDE.md",
      })
      .returning({ id: project.id });

    // Seed REQ-001, REQ-002 in project 1
    await db.insert(requirements).values([
      { key: "REQ-001", title: "First", description: "d", provenance: "imported", projectId: p1.id },
      { key: "REQ-002", title: "Second", description: "d", provenance: "imported", projectId: p1.id },
    ]);

    // Project 1 next is REQ-003
    const keyP1 = await db.transaction((tx) => nextRequirementKey(tx, p1.id));
    assert.equal(keyP1, "REQ-003", "project 1 should continue from REQ-002");

    // Project 2 starts fresh at REQ-001 (has no requirements of its own)
    const keyP2 = await db.transaction((tx) => nextRequirementKey(tx, p2.id));
    assert.equal(keyP2, "REQ-001", "project 2 should start at REQ-001 independently");
  } finally {
    await close();
  }
});

test("nextRequirementKey uses max existing number + 1, not count (gap-safe)", async () => {
  const { db, close } = await createTestDb();
  try {
    const projectId = await seedProject(db);
    await db.insert(requirements).values([
      { key: "REQ-001", title: "a", description: "", provenance: "imported", projectId },
      { key: "REQ-005", title: "b", description: "", provenance: "imported", projectId },
    ]);
    const key = await db.transaction((tx) => nextRequirementKey(tx, projectId));
    assert.equal(key, "REQ-006");
  } finally {
    await close();
  }
});
