import test from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { createTestDb } from "../db/client";
import { project, events } from "../db/schema";
import { bindAndClone, clonePathFor } from "./connect";

test("clonePathFor maps owner/name under the clone root", () => {
  const p = clonePathFor("acme/throughline");
  assert.match(p, /acme__throughline$/);
});

test("bindAndClone clones then records the binding + project.bound", async () => {
  const { db, close } = await createTestDb();
  try {
    const calls: { token: string; dir: string; repoFullName: string; defaultBranch: string }[] = [];
    const bound = await bindAndClone(
      db,
      { repoFullName: "acme/throughline", installationId: 4242, defaultBranch: "main", actorId: null },
      {
        getToken: async (id) => `tok-${id}`,
        clone: async (o) => {
          calls.push(o);
        },
      },
    );

    assert.equal(bound.repoFullName, "acme/throughline");
    // cloned with the installation token, into the derived path, on the branch
    assert.equal(calls.length, 1);
    assert.equal(calls[0].token, "tok-4242");
    assert.equal(calls[0].defaultBranch, "main");
    assert.match(calls[0].dir, /acme__throughline$/);

    const [row] = await db.select().from(project);
    assert.equal(row.repoFullName, "acme/throughline");
    assert.equal(row.installationId, 4242);
    assert.equal(row.localClonePath, calls[0].dir);

    const evs = await db.select().from(events).where(eq(events.type, "project.bound"));
    assert.equal(evs.length, 1);
    assert.equal((evs[0].payload as { repo_full_name: string }).repo_full_name, "acme/throughline");
  } finally {
    await close();
  }
});

test("bindAndClone adds a second project for a different repo, refuses a duplicate repo (multi-project)", async () => {
  const { db, close } = await createTestDb();
  try {
    const ok = async () => {};
    await bindAndClone(db, { repoFullName: "acme/one", installationId: 1, defaultBranch: "main" }, { getToken: async () => "t", clone: ok });
    // a different repo is added (multi-project)
    await bindAndClone(db, { repoFullName: "acme/two", installationId: 2, defaultBranch: "main" }, { getToken: async () => "t", clone: ok });
    const rows = await db.select().from(project);
    assert.equal(rows.length, 2);
    // binding the same repo again is refused
    await assert.rejects(
      bindAndClone(db, { repoFullName: "acme/one", installationId: 1, defaultBranch: "main" }, { getToken: async () => "t", clone: ok }),
      /already bound/i,
    );
    const after = await db.select().from(project);
    assert.equal(after.length, 2);
  } finally {
    await close();
  }
});
