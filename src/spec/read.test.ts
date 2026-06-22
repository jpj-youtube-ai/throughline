import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createTestDb } from "../db/client";
import { project } from "../db/schema";
import { readSpec } from "./read";

function tmpClone(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "tl-spec-"));
}

test("readSpec returns the clone's SPEC.md content and path", async () => {
  const { db, close } = await createTestDb();
  const dir = tmpClone();
  try {
    fs.writeFileSync(path.join(dir, "SPEC.md"), "# Orbit — Specification\n## Shipped (1)\n");
    await db.insert(project).values({
      repoFullName: "acme/repo",
      defaultBranch: "main",
      installationId: 1,
      localClonePath: dir,
    });
    const r = await readSpec(db);
    assert.equal(r.path, "SPEC.md");
    assert.match(r.content ?? "", /Orbit — Specification/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    await close();
  }
});

test("readSpec returns null content when the SPEC.md file is absent", async () => {
  const { db, close } = await createTestDb();
  const dir = tmpClone(); // empty dir, no SPEC.md
  try {
    await db.insert(project).values({
      repoFullName: "acme/repo",
      defaultBranch: "main",
      installationId: 1,
      localClonePath: dir,
    });
    const r = await readSpec(db);
    assert.equal(r.content, null);
    assert.equal(r.path, "SPEC.md"); // project.specPath default
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    await close();
  }
});

test("readSpec returns nulls when no project is bound", async () => {
  const { db, close } = await createTestDb();
  try {
    assert.deepEqual(await readSpec(db), { content: null, path: null });
  } finally {
    await close();
  }
});

test("readSpec(db, projectId) returns only that project's spec", async () => {
  const { db, close } = await createTestDb();
  const dir1 = tmpClone();
  const dir2 = tmpClone();
  try {
    fs.writeFileSync(path.join(dir1, "SPEC.md"), "# Project One Spec\n");
    fs.writeFileSync(path.join(dir2, "SPEC.md"), "# Project Two Spec\n");

    const [p1] = await db
      .insert(project)
      .values({ repoFullName: "org/repo1", defaultBranch: "main", installationId: 1, localClonePath: dir1 })
      .returning({ id: project.id });
    const [p2] = await db
      .insert(project)
      .values({ repoFullName: "org/repo2", defaultBranch: "main", installationId: 2, localClonePath: dir2 })
      .returning({ id: project.id });

    const r1 = await readSpec(db, p1.id);
    assert.match(r1.content ?? "", /Project One Spec/);

    const r2 = await readSpec(db, p2.id);
    assert.match(r2.content ?? "", /Project Two Spec/);

    // Unknown projectId → no project found → nulls
    const rNone = await readSpec(db, "00000000-0000-0000-0000-000000000000");
    assert.deepEqual(rNone, { content: null, path: null });
  } finally {
    fs.rmSync(dir1, { recursive: true, force: true });
    fs.rmSync(dir2, { recursive: true, force: true });
    await close();
  }
});
