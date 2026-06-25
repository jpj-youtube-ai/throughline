import test from "node:test";
import assert from "node:assert/strict";
import { createTestDb, type Db } from "../db/client";
import { project, requirements, tasks } from "../db/schema";
import { buildSpecContent } from "./content";

async function seed(db: Db, repo: string, inst: number): Promise<string> {
  const [p] = await db.insert(project).values({ repoFullName: repo, defaultBranch: "main", installationId: inst, localClonePath: "/x" }).returning({ id: project.id });
  return p.id;
}

test("buildSpecContent renders the project's requirements + linked tasks", async () => {
  const { db, close } = await createTestDb();
  try {
    const pid = await seed(db, "a/b", 1);
    const [r] = await db.insert(requirements).values({ key: "REQ-003", title: "Event log", description: "d", provenance: "imported", status: "shipped", projectId: pid }).returning({ id: requirements.id });
    await db.insert(tasks).values({ key: "TASK-001", title: "Build the log", body: "b", requirementId: r.id, effort: 1, risk: "low", confidence: 50, projectId: pid });

    const { content, requirementCount } = await buildSpecContent(db, pid);
    assert.equal(requirementCount, 1);
    assert.match(content, /### REQ-003 — Event log/);
    assert.match(content, /TASK-001/);
  } finally { await close(); }
});

test("buildSpecContent is project-scoped; zero for an empty project", async () => {
  const { db, close } = await createTestDb();
  try {
    const a = await seed(db, "a/alpha", 1);
    const b = await seed(db, "a/beta", 2);
    await db.insert(requirements).values({ key: "REQ-001", title: "Alpha req", description: "d", provenance: "imported", status: "planned", projectId: a });

    const ra = await buildSpecContent(db, a);
    assert.equal(ra.requirementCount, 1);
    assert.match(ra.content, /Alpha req/);

    const rb = await buildSpecContent(db, b);
    assert.equal(rb.requirementCount, 0);
    assert.doesNotMatch(rb.content, /Alpha req/);
  } finally { await close(); }
});
