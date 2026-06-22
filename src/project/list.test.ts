import test from "node:test";
import assert from "node:assert/strict";
import { createTestDb } from "../db/client";
import { bindProject } from "./bind";
import { listProjects } from "./list";

const BASE = {
  installationId: 12345,
  defaultBranch: "main",
  localClonePath: "/tmp/clone",
};

test("listProjects returns an empty array when no projects are bound", async () => {
  const { db, close } = await createTestDb();
  try {
    const result = await listProjects(db);
    assert.deepEqual(result, []);
  } finally {
    await close();
  }
});

test("listProjects returns all bound projects ordered by createdAt", async () => {
  const { db, close } = await createTestDb();
  try {
    const a = await bindProject(db, { ...BASE, repoFullName: "acme/alpha" });
    const b = await bindProject(db, { ...BASE, repoFullName: "acme/beta" });

    const result = await listProjects(db);
    assert.equal(result.length, 2);
    assert.equal(result[0].id, a.id);
    assert.equal(result[0].repoFullName, "acme/alpha");
    assert.equal(result[0].defaultBranch, "main");
    assert.equal(result[1].id, b.id);
    assert.equal(result[1].repoFullName, "acme/beta");
  } finally {
    await close();
  }
});

test("listProjects returns only the shape {id, repoFullName, defaultBranch}", async () => {
  const { db, close } = await createTestDb();
  try {
    await bindProject(db, { ...BASE, repoFullName: "acme/throughline" });
    const [row] = await listProjects(db);
    assert.ok(row.id, "has id");
    assert.equal(row.repoFullName, "acme/throughline");
    assert.equal(row.defaultBranch, "main");
    // No extra fields beyond the three declared
    assert.deepEqual(Object.keys(row).sort(), ["defaultBranch", "id", "repoFullName"]);
  } finally {
    await close();
  }
});
