import test from "node:test";
import assert from "node:assert/strict";
import { createTestDb } from "../db/client";
import { project, events } from "../db/schema";
import { bindProject } from "./bind";

const INPUT = {
  repoFullName: "acme/throughline",
  installationId: 12345,
  defaultBranch: "main",
  localClonePath: "/tmp/clone",
};

test("bindProject creates the project singleton and emits project.bound in one transaction", async () => {
  const { db, close } = await createTestDb();
  try {
    const bound = await bindProject(db, INPUT);
    assert.ok(bound.id);

    const rows = await db.select().from(project);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].repoFullName, "acme/throughline");
    assert.equal(rows[0].installationId, 12345);
    assert.equal(rows[0].defaultBranch, "main");
    assert.equal(rows[0].specPath, "SPEC.md", "schema default applied");
    assert.equal(rows[0].claudeMdPath, "CLAUDE.md", "schema default applied");

    const evs = await db.select().from(events);
    assert.equal(evs.length, 1);
    assert.equal(evs[0].type, "project.bound");
    assert.equal(evs[0].subjectId, bound.id);
    assert.deepEqual(evs[0].payload, {
      repo_full_name: "acme/throughline",
      installation_id: 12345,
      default_branch: "main",
    });
  } finally {
    await close();
  }
});

test("binding is a singleton: a second bind is refused and writes nothing", async () => {
  const { db, close } = await createTestDb();
  try {
    await bindProject(db, INPUT);
    await assert.rejects(bindProject(db, { ...INPUT, repoFullName: "acme/other" }), /already bound/i);

    const rows = await db.select().from(project);
    assert.equal(rows.length, 1, "still one project");
    assert.equal(rows[0].repoFullName, "acme/throughline", "original binding intact");
    assert.equal((await db.select().from(events)).length, 1, "no second event");
  } finally {
    await close();
  }
});
