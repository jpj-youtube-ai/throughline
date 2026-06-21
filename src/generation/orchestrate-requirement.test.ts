// src/generation/orchestrate-requirement.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { createTestDb } from "../db/client";
import { requirements, tasks, project } from "../db/schema";
import { generateForRequirement } from "./orchestrate";
import type { GenerateTasksResult } from "./run";

const fakeGenerate = async (): Promise<GenerateTasksResult> => ({
  ok: true,
  model: "fake",
  usage: null,
  output: {
    new_requirements: [],
    tasks: [{ title: "Do it", requirement_key: "REQ-001", body: { pointers: ["src/x.ts"], acceptance_check: "ok" }, effort: 1, risk: "low", confidence: 90 }],
  },
});

test("generateForRequirement guards: missing requirement", async () => {
  const { db, close } = await createTestDb();
  try {
    const r = await generateForRequirement(db, "00000000-0000-0000-0000-000000000000");
    assert.equal(r.ok, false);
    assert.match(r.failure ?? "", /requirement not found/i);
  } finally { await close(); }
});

test("generateForRequirement guards: no project bound", async () => {
  const { db, close } = await createTestDb();
  try {
    const [req] = await db.insert(requirements).values({ key: "REQ-001", title: "t", description: "d", provenance: "imported" }).returning({ id: requirements.id });
    const r = await generateForRequirement(db, req.id, { generate: fakeGenerate });
    assert.equal(r.ok, false);
    assert.match(r.failure ?? "", /no project bound/i);
  } finally { await close(); }
});

test("generateForRequirement happy path with an injected generator persists tasks", async () => {
  const { db, close } = await createTestDb();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "orbit-"));
  fs.writeFileSync(path.join(dir, "SPEC.md"), "# Spec\n");
  fs.writeFileSync(path.join(dir, "CLAUDE.md"), "# Conventions\n");
  try {
    const [req] = await db.insert(requirements).values({ key: "REQ-001", title: "Search", description: "Full-text search", provenance: "imported" }).returning({ id: requirements.id });
    await db.insert(project).values({
      repoFullName: "o/orbit", installationId: 1, defaultBranch: "main",
      localClonePath: dir, specPath: "SPEC.md", claudeMdPath: "CLAUDE.md",
    });

    const r = await generateForRequirement(db, req.id, { generate: fakeGenerate });
    assert.equal(r.ok, true);
    assert.deepEqual(r.taskKeys, ["TASK-001"]);

    const rows = await db.select().from(tasks).where(eq(tasks.requirementId, req.id));
    assert.equal(rows.length, 1);

    // already-has-tasks guard on a second run
    const again = await generateForRequirement(db, req.id, { generate: fakeGenerate });
    assert.equal(again.ok, false);
    assert.match(again.failure ?? "", /already has tasks/i);
  } finally {
    await close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
