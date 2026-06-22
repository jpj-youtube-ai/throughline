import test from "node:test";
import assert from "node:assert/strict";
import { createTestDb } from "../db/client";
import { requirements, tasks, project } from "../db/schema";
import { reconcileSpec, reconcileStructural, structuralReconciliationForProject } from "./reconcile";

test("reconcileSpec flags a mismatch (ignoring trailing whitespace)", () => {
  assert.equal(reconcileSpec("same", "same").stale, false);
  assert.equal(reconcileSpec("a", "b").stale, true);
  assert.equal(reconcileSpec("x\n\n", "x").stale, false);
});

test("reconcileStructural reports stale when SPEC.md differs from the requirements", async () => {
  const { db, close } = await createTestDb();
  try {
    const [proj] = await db
      .insert(project)
      .values({ repoFullName: "o/r", installationId: 1, defaultBranch: "main", localClonePath: "/t", specPath: "SPEC.md", claudeMdPath: "CLAUDE.md" })
      .returning({ id: project.id });
    const [r3] = await db
      .insert(requirements)
      .values({ key: "REQ-003", title: "Event log", description: "d", provenance: "imported", status: "shipped", projectId: proj.id })
      .returning({ id: requirements.id });
    await db
      .insert(requirements)
      .values({ key: "REQ-005", title: "Submit idea", description: "d", provenance: "voted", status: "planned", projectId: proj.id });
    await db
      .insert(tasks)
      .values({ key: "TASK-001", title: "Build the log", body: "b", requirementId: r3.id, effort: 1, risk: "low", confidence: 50, projectId: proj.id });

    // An obviously-out-of-date file is stale.
    const stale = await reconcileStructural(db, "# old hand-written spec\n");
    assert.equal(stale.specStale, true);
    assert.equal(stale.requirementCount, 2);
    assert.match(stale.rendered, /REQ-003 — Event log/);

    // Feeding back exactly what the requirements render to is up to date.
    const current = await reconcileStructural(db, stale.rendered);
    assert.equal(current.specStale, false);
  } finally {
    await close();
  }
});

test("structuralReconciliationForProject reports unbound when no project exists", async () => {
  const { db, close } = await createTestDb();
  try {
    // Without a project row, we can't insert requirements (FK constraint).
    // The test verifies the "unbound" path — no project means reconcile returns bound:false.
    const r = await structuralReconciliationForProject(db);
    assert.equal(r.bound, false);
    assert.equal(r.specStale, false);
    assert.equal(r.requirementCount, 0);
  } finally {
    await close();
  }
});

test("reconcileStructural with two projects only counts the target project's requirements", async () => {
  const { db, close } = await createTestDb();
  try {
    const [projA] = await db
      .insert(project)
      .values({ repoFullName: "acme/alpha", installationId: 10, defaultBranch: "main", localClonePath: "/a", specPath: "SPEC.md", claudeMdPath: "CLAUDE.md" })
      .returning({ id: project.id });
    const [projB] = await db
      .insert(project)
      .values({ repoFullName: "acme/beta", installationId: 20, defaultBranch: "main", localClonePath: "/b", specPath: "SPEC.md", claudeMdPath: "CLAUDE.md" })
      .returning({ id: project.id });

    await db.insert(requirements).values({ key: "REQ-001", title: "Alpha only", description: "d", provenance: "imported", status: "planned", projectId: projA.id });
    await db.insert(requirements).values({ key: "REQ-001", title: "Beta only", description: "d", provenance: "imported", status: "planned", projectId: projB.id });
    await db.insert(requirements).values({ key: "REQ-002", title: "Beta also", description: "d", provenance: "imported", status: "planned", projectId: projB.id });

    const rA = await reconcileStructural(db, "# old", projA.id);
    assert.equal(rA.requirementCount, 1, "project A has exactly 1 requirement");
    assert.match(rA.rendered, /Alpha only/);
    assert.doesNotMatch(rA.rendered, /Beta only/, "project A's render must not include project B requirements");

    const rB = await reconcileStructural(db, "# old", projB.id);
    assert.equal(rB.requirementCount, 2, "project B has exactly 2 requirements");
    assert.match(rB.rendered, /Beta only/);
    assert.doesNotMatch(rB.rendered, /Alpha only/, "project B's render must not include project A requirements");
  } finally {
    await close();
  }
});

test("structuralReconciliationForProject with projectId scopes to that project", async () => {
  const { db, close } = await createTestDb();
  try {
    const [projA] = await db
      .insert(project)
      .values({ repoFullName: "acme/alpha", installationId: 10, defaultBranch: "main", localClonePath: "/nonexistent-a", specPath: "SPEC.md", claudeMdPath: "CLAUDE.md" })
      .returning({ id: project.id });
    const [projB] = await db
      .insert(project)
      .values({ repoFullName: "acme/beta", installationId: 20, defaultBranch: "main", localClonePath: "/nonexistent-b", specPath: "SPEC.md", claudeMdPath: "CLAUDE.md" })
      .returning({ id: project.id });

    await db.insert(requirements).values({ key: "REQ-001", title: "Alpha req", description: "d", provenance: "imported", status: "planned", projectId: projA.id });
    await db.insert(requirements).values({ key: "REQ-001", title: "Beta req A", description: "d", provenance: "imported", status: "planned", projectId: projB.id });
    await db.insert(requirements).values({ key: "REQ-002", title: "Beta req B", description: "d", provenance: "imported", status: "planned", projectId: projB.id });

    const rA = await structuralReconciliationForProject(db, projA.id);
    assert.equal(rA.bound, true);
    assert.equal(rA.requirementCount, 1, "project A reconcile sees only 1 requirement");

    const rB = await structuralReconciliationForProject(db, projB.id);
    assert.equal(rB.bound, true);
    assert.equal(rB.requirementCount, 2, "project B reconcile sees only 2 requirements");
  } finally {
    await close();
  }
});
