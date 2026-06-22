import test from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { createTestDb } from "../db/client";
import { requirements, tasks, events, project } from "../db/schema";
import { renderSpec } from "./render";
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

test("materializeSpec renders from the DB and emits spec.materialized with the commit sha", async () => {
  const { db, close } = await createTestDb();
  try {
    const [proj] = await db
      .insert(project)
      .values({ repoFullName: "acme/repo", defaultBranch: "main", installationId: 1, localClonePath: "/x" })
      .returning({ id: project.id });
    const [r1] = await db
      .insert(requirements)
      .values({ key: "REQ-003", title: "Event log", description: "d", provenance: "imported", status: "shipped", projectId: proj.id })
      .returning({ id: requirements.id });
    await db
      .insert(requirements)
      .values({ key: "REQ-005", title: "Submit idea", description: "d", provenance: "voted", status: "planned", projectId: proj.id });
    await db
      .insert(tasks)
      .values({ key: "TASK-001", title: "Build the log", body: "b", requirementId: r1.id, effort: 1, risk: "low", confidence: 50, projectId: proj.id });

    let captured = "";
    const fakeCommit = async (content: string): Promise<{ sha: string }> => {
      captured = content;
      return { sha: "abc123" };
    };

    const res = await materializeSpec(db, fakeCommit);
    assert.equal(res.requirementCount, 2);
    assert.equal(res.sha, "abc123");
    assert.match(captured, /### REQ-003 — Event log/);
    assert.match(captured, /TASK-001/);

    const evs = await db.select().from(events).where(eq(events.type, "spec.materialized"));
    assert.equal(evs.length, 1);
    assert.deepEqual(evs[0].payload, { count: 2, commit_sha: "abc123" });
    assert.equal(evs[0].projectId, proj.id, "spec.materialized event carries projectId");
  } finally {
    await close();
  }
});

test("materializeSpec with two projects only renders the target project's requirements", async () => {
  const { db, close } = await createTestDb();
  try {
    const [projA] = await db
      .insert(project)
      .values({ repoFullName: "acme/alpha", defaultBranch: "main", installationId: 1, localClonePath: "/a" })
      .returning({ id: project.id });
    const [projB] = await db
      .insert(project)
      .values({ repoFullName: "acme/beta", defaultBranch: "main", installationId: 2, localClonePath: "/b" })
      .returning({ id: project.id });

    await db.insert(requirements).values({ key: "REQ-001", title: "Alpha req", description: "d", provenance: "imported", status: "planned", projectId: projA.id });
    await db.insert(requirements).values({ key: "REQ-001", title: "Beta req", description: "d", provenance: "imported", status: "planned", projectId: projB.id });

    let capturedA = "";
    const commitA = async (content: string): Promise<{ sha: string }> => { capturedA = content; return { sha: "sha-a" }; };

    // Materialize only project A
    const resA = await materializeSpec(db, projA.id, commitA);
    assert.equal(resA.requirementCount, 1);
    assert.match(capturedA, /Alpha req/);
    assert.doesNotMatch(capturedA, /Beta req/, "Project A spec must not include project B requirements");

    let capturedB = "";
    const commitB = async (content: string): Promise<{ sha: string }> => { capturedB = content; return { sha: "sha-b" }; };

    // Materialize only project B
    const resB = await materializeSpec(db, projB.id, commitB);
    assert.equal(resB.requirementCount, 1);
    assert.match(capturedB, /Beta req/);
    assert.doesNotMatch(capturedB, /Alpha req/, "Project B spec must not include project A requirements");
  } finally {
    await close();
  }
});
