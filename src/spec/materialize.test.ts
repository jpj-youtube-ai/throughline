import test from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { createTestDb } from "../db/client";
import { requirements, tasks, events, project } from "../db/schema";
import { renderSpec } from "./render";
import { buildSpecContent } from "./content";
import { materializeSpec } from "./materialize";

test("renderSpec groups requirements into shipped / planned with linked tasks", () => {
  const content = renderSpec(
    [
      { key: "REQ-003", title: "Event log", description: "the log", status: "shipped" },
      { key: "REQ-005", title: "Submit idea", description: "", status: "planned" },
    ],
    [{ key: "TASK-001", title: "Build the log", requirementKey: "REQ-003" }],
  );
  assert.match(content, /## Shipped \(1\)/);
  assert.match(content, /### REQ-003 — Event log/);
  assert.match(content, /- TASK-001 — Build the log/);
  assert.match(content, /## Planned \(1\)/);
  assert.match(content, /### REQ-005 — Submit idea/);
  assert.match(content, /do not hand-edit/i);
});

async function seedProj(db: Awaited<ReturnType<typeof createTestDb>>["db"]) {
  const [p] = await db.insert(project).values({
    repoFullName: "acme/repo", installationId: 7, defaultBranch: "main",
    localClonePath: "/clones/acme__repo", specPath: "SPEC.md",
  }).returning({ id: project.id });
  return p.id;
}

test("materializeSpec is a no-op when the clone already matches (no fetch/commit/push/event)", async () => {
  const { db, close } = await createTestDb();
  try {
    const pid = await seedProj(db);
    await db.insert(requirements).values({ key: "REQ-001", title: "A", description: "d", provenance: "imported", status: "planned", projectId: pid });
    const { content } = await buildSpecContent(db, pid); // exactly what the clone "has"

    let synced = false, committed = false, pushed = false;
    const r = await materializeSpec(db, pid, {
      syncRemote: async () => { synced = true; },
      readFile: () => content,
      commit: () => { committed = true; return { sha: "x" }; },
      push: async () => { pushed = true; },
    });
    assert.equal(r.status, "already-materialized");
    assert.equal(synced, false, "fast path: no fetch when local already matches");
    assert.equal(committed, false);
    assert.equal(pushed, false);
    assert.equal((await db.select().from(events).where(eq(events.type, "spec.materialized"))).length, 0);
  } finally { await close(); }
});

test("materializeSpec reconciles, commits, pushes, and emits when content differs", async () => {
  const { db, close } = await createTestDb();
  try {
    const pid = await seedProj(db);
    const [r1] = await db.insert(requirements).values({ key: "REQ-003", title: "Event log", description: "d", provenance: "imported", status: "shipped", projectId: pid }).returning({ id: requirements.id });
    await db.insert(tasks).values({ key: "TASK-001", title: "Build the log", body: "b", requirementId: r1.id, effort: 1, risk: "low", confidence: 50, projectId: pid });

    let committedContent = "", syncedArgs: unknown[] = [], pushedArgs: unknown[] = [];
    const r = await materializeSpec(db, pid, {
      syncRemote: async (clone, repo, inst, branch) => { syncedArgs = [clone, repo, inst, branch]; },
      readFile: () => "", // clone has no SPEC.md
      commit: (_clone, _rel, content) => { committedContent = content; return { sha: "sha1" }; },
      push: async (clone, repo, inst, branch) => { pushedArgs = [clone, repo, inst, branch]; },
    });
    assert.equal(r.status, "materialized");
    assert.equal(r.sha, "sha1");
    assert.equal(r.requirementCount, 1);
    assert.match(committedContent, /### REQ-003 — Event log/);
    assert.deepEqual(syncedArgs, ["/clones/acme__repo", "acme/repo", 7, "main"]); // reconciled first
    assert.deepEqual(pushedArgs, ["/clones/acme__repo", "acme/repo", 7, "main"]);
    const [ev] = await db.select().from(events).where(eq(events.type, "spec.materialized"));
    assert.ok(ev);
    assert.deepEqual(ev.payload, { count: 1, commit_sha: "sha1" });
    assert.equal(ev.projectId, pid);
  } finally { await close(); }
});

test("materializeSpec scopes to the target project's requirements", async () => {
  const { db, close } = await createTestDb();
  try {
    const [pa] = await db.insert(project).values({ repoFullName: "acme/alpha", installationId: 1, defaultBranch: "main", localClonePath: "/a", specPath: "SPEC.md" }).returning({ id: project.id });
    const [pb] = await db.insert(project).values({ repoFullName: "acme/beta", installationId: 2, defaultBranch: "main", localClonePath: "/b", specPath: "SPEC.md" }).returning({ id: project.id });
    await db.insert(requirements).values({ key: "REQ-001", title: "Alpha req", description: "d", provenance: "imported", status: "planned", projectId: pa.id });
    await db.insert(requirements).values({ key: "REQ-001", title: "Beta req", description: "d", provenance: "imported", status: "planned", projectId: pb.id });

    let captured = "";
    await materializeSpec(db, pa.id, { syncRemote: async () => {}, readFile: () => "", commit: (_c, _r, content) => { captured = content; return { sha: "s" }; }, push: async () => {} });
    assert.match(captured, /Alpha req/);
    assert.doesNotMatch(captured, /Beta req/);
  } finally { await close(); }
});
