import test from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { createTestDb } from "../db/client";
import { project, events } from "../db/schema";
import { requestNarrative } from "./regen";

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
