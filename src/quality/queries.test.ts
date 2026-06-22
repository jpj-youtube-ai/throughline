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
