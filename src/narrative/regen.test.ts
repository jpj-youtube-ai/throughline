import test from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { createTestDb, type Db } from "../db/client";
import { project, events, narratives } from "../db/schema";
import { requestNarrative, narrativeRegenPending, materializeNarrativeIfRequested } from "./regen";
import { emitEvent } from "../db/events";

test("requestNarrative emits narrative.requested for the project", async () => {
  const { db, close } = await createTestDb();
  try {
    const [p] = await db.insert(project).values({ repoFullName: "a/b", installationId: 1, defaultBranch: "main", localClonePath: "/x" }).returning({ id: project.id });
    await requestNarrative(db, { projectId: p.id });
    const evs = await db.select().from(events).where(eq(events.type, "narrative.requested"));
    assert.equal(evs.length, 1);
    assert.equal(evs[0].projectId, p.id);
    assert.equal(evs[0].subjectType, "project");
  } finally { await close(); }
});

async function fakeGenerated(db: Db, projectId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.insert(narratives).values({ eventCount: 1, content: { chapters: [] }, projectId, roadmapHtml: null });
    await emitEvent(tx, {
      type: "narrative.generated",
      subjectType: "project",
      subjectId: projectId,
      payload: {},
      projectId,
    });
  });
}

test("narrativeRegenPending: true after a request, false once generated is newer", async () => {
  const { db, close } = await createTestDb();
  try {
    const [p] = await db.insert(project).values({ repoFullName: "a/b", installationId: 1, defaultBranch: "main", localClonePath: "/x" }).returning({ id: project.id });
    assert.equal(await narrativeRegenPending(db, p.id), false); // no request yet
    await requestNarrative(db, { projectId: p.id });
    assert.equal(await narrativeRegenPending(db, p.id), true);
    // a fake materialize that emits narrative.generated (newer seq) clears it
    await materializeNarrativeIfRequested(db, p.id, async (_d, pid) => { await fakeGenerated(db, pid); });
    assert.equal(await narrativeRegenPending(db, p.id), false);
  } finally { await close(); }
});

test("materializeNarrativeIfRequested only runs when a request is pending", async () => {
  const { db, close } = await createTestDb();
  try {
    const [p] = await db.insert(project).values({ repoFullName: "a/c", installationId: 2, defaultBranch: "main", localClonePath: "/x" }).returning({ id: project.id });
    let calls = 0;
    const fake = async () => { calls++; };
    assert.deepEqual(await materializeNarrativeIfRequested(db, p.id, fake), { regenerated: false });
    assert.equal(calls, 0);
    await requestNarrative(db, { projectId: p.id });
    assert.deepEqual(await materializeNarrativeIfRequested(db, p.id, fake), { regenerated: true });
    assert.equal(calls, 1);
  } finally { await close(); }
});
