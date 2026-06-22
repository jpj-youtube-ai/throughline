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

    const recent = await recentDigests(db, undefined, 10);
    assert.equal(recent.length, 2);
    assert.equal(recent[0].text, "newer");
    assert.equal(recent[0].eventCount, 5);
    assert.equal(recent[1].text, "older");
  } finally {
    await close();
  }
});

test("digestSummary and recentDigests scope to a single project when projectId is given", async () => {
  const { db, close } = await createTestDb();
  try {
    const [p1] = await db
      .insert(project)
      .values({ repoFullName: "o/r1", installationId: 1, defaultBranch: "main", localClonePath: "/t1" })
      .returning({ id: project.id });
    const [p2] = await db
      .insert(project)
      .values({ repoFullName: "o/r2", installationId: 2, defaultBranch: "main", localClonePath: "/t2" })
      .returning({ id: project.id });

    await db.insert(events).values([
      { type: "digest.generated", subjectType: "project", payload: { text: "p1-digest", event_count: 3 }, createdAt: new Date(1000), projectId: p1.id },
      { type: "digest.generated", subjectType: "project", payload: { text: "p2-digest", event_count: 7 }, createdAt: new Date(2000), projectId: p2.id },
    ]);

    const s1 = await digestSummary(db, p1.id);
    assert.equal(s1.count, 1);
    assert.equal(s1.lastGeneratedAt?.getTime(), 1000);

    const s2 = await digestSummary(db, p2.id);
    assert.equal(s2.count, 1);
    assert.equal(s2.lastGeneratedAt?.getTime(), 2000);

    const r1 = await recentDigests(db, p1.id, 10);
    assert.equal(r1.length, 1);
    assert.equal(r1[0].text, "p1-digest");

    const r2 = await recentDigests(db, p2.id, 10);
    assert.equal(r2.length, 1);
    assert.equal(r2[0].text, "p2-digest");
  } finally {
    await close();
  }
});
