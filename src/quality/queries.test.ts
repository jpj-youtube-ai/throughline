import test from "node:test";
import assert from "node:assert/strict";
import { createTestDb } from "../db/client";
import { events, project } from "../db/schema";
import { countRationales } from "./queries";

test("countRationales counts only events carrying a why", async () => {
  const { db, close } = await createTestDb();
  try {
    assert.equal(await countRationales(db), 0);
    const [proj] = await db
      .insert(project)
      .values({ repoFullName: "o/r", installationId: 1, defaultBranch: "main", localClonePath: "/t", specPath: "SPEC.md", claudeMdPath: "CLAUDE.md" })
      .returning({ id: project.id });
    await db.insert(events).values([
      { type: "idea.submitted", subjectType: "idea", payload: {}, rationale: "a why", projectId: proj.id },
      { type: "idea.approved", subjectType: "idea", payload: {}, rationale: "another", projectId: proj.id },
      { type: "task.claimed", subjectType: "task", payload: {}, rationale: null, projectId: proj.id },
    ]);
    assert.equal(await countRationales(db), 2);
  } finally {
    await close();
  }
});

test("countRationales with projectId only counts rationales for that project", async () => {
  const { db, close } = await createTestDb();
  try {
    const [projA] = await db
      .insert(project)
      .values({ repoFullName: "acme/alpha", installationId: 1, defaultBranch: "main", localClonePath: "/a" })
      .returning({ id: project.id });
    const [projB] = await db
      .insert(project)
      .values({ repoFullName: "acme/beta", installationId: 2, defaultBranch: "main", localClonePath: "/b" })
      .returning({ id: project.id });

    await db.insert(events).values([
      { type: "idea.submitted", subjectType: "idea", payload: {}, rationale: "alpha why 1", projectId: projA.id },
      { type: "idea.approved", subjectType: "idea", payload: {}, rationale: "alpha why 2", projectId: projA.id },
      { type: "idea.submitted", subjectType: "idea", payload: {}, rationale: "beta why", projectId: projB.id },
      { type: "task.claimed", subjectType: "task", payload: {}, rationale: null, projectId: projA.id },
    ]);

    assert.equal(await countRationales(db, projA.id), 2, "project A has 2 rationales");
    assert.equal(await countRationales(db, projB.id), 1, "project B has 1 rationale");
    assert.equal(await countRationales(db), 3, "unscoped returns all 3 rationales");
  } finally {
    await close();
  }
});
