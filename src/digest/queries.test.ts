import test from "node:test";
import assert from "node:assert/strict";
import { createTestDb } from "../db/client";
import { events, project } from "../db/schema";
import { digestSummary, recentDigests } from "./queries";

test("digestSummary returns zero/null with no digest events", async () => {
  const { db, close } = await createTestDb();
  try {
    assert.deepEqual(await digestSummary(db), { count: 0, lastGeneratedAt: null });
  } finally {
    await close();
  }
});

test("digestSummary counts digest.generated and reports the latest; recentDigests is newest-first", async () => {
  const { db, close } = await createTestDb();
  try {
    const [p] = await db
      .insert(project)
      .values({ repoFullName: "o/r", installationId: 1, defaultBranch: "main", localClonePath: "/t", specPath: "SPEC.md", claudeMdPath: "CLAUDE.md" })
      .returning({ id: project.id });
    await db.insert(events).values([
      { type: "digest.generated", subjectType: "project", payload: { text: "older", event_count: 2 }, createdAt: new Date(1000), projectId: p.id },
      { type: "digest.generated", subjectType: "project", payload: { text: "newer", event_count: 5 }, createdAt: new Date(3000), projectId: p.id },
      { type: "idea.submitted", subjectType: "idea", payload: {}, rationale: "x", createdAt: new Date(2000), projectId: p.id },
    ]);
    const s = await digestSummary(db);
    assert.equal(s.count, 2);
    assert.equal(s.lastGeneratedAt?.getTime(), 3000);

    const recent = await recentDigests(db, 10);
    assert.equal(recent.length, 2);
    assert.equal(recent[0].text, "newer");
    assert.equal(recent[0].eventCount, 5);
    assert.equal(recent[1].text, "older");
  } finally {
    await close();
  }
});
