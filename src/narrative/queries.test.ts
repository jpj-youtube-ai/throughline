import test from "node:test";
import assert from "node:assert/strict";
import { createTestDb } from "../db/client";
import { narratives, project } from "../db/schema";
import { getLatestNarrative } from "./queries";

test("getLatestNarrative returns null with no rows", async () => {
  const { db, close } = await createTestDb();
  try {
    assert.equal(await getLatestNarrative(db), null);
  } finally {
    await close();
  }
});

test("getLatestNarrative scopes to a single project when projectId is given", async () => {
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

    const content1 = { chapters: [{ heading: "P1 story", prose: "...", refs: [] }] };
    const content2 = { chapters: [{ heading: "P2 story", prose: "...", refs: [] }] };

    await db.insert(narratives).values([
      { eventCount: 3, content: content1, projectId: p1.id, generatedAt: new Date(1000) },
      { eventCount: 7, content: content2, projectId: p2.id, generatedAt: new Date(2000) },
    ]);

    const n1 = await getLatestNarrative(db, p1.id);
    assert.ok(n1 !== null);
    assert.equal((n1.content as typeof content1).chapters[0].heading, "P1 story");
    assert.equal(n1.eventCount, 3);

    const n2 = await getLatestNarrative(db, p2.id);
    assert.ok(n2 !== null);
    assert.equal((n2.content as typeof content2).chapters[0].heading, "P2 story");
    assert.equal(n2.eventCount, 7);

    // Without filter: returns most recent (p2)
    const nAll = await getLatestNarrative(db);
    assert.ok(nAll !== null);
    assert.equal((nAll.content as typeof content2).chapters[0].heading, "P2 story");
  } finally {
    await close();
  }
});
