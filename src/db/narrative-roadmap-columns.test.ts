import test from "node:test";
import assert from "node:assert/strict";
import { createTestDb } from "./client";
import { project, narratives } from "./schema";
import { eq } from "drizzle-orm";

test("narratives.roadmap_html round-trip", async () => {
  const { db, close } = await createTestDb();
  try {
    const [p] = await db.insert(project).values({ repoFullName: "a/b", installationId: 1, defaultBranch: "main", localClonePath: "/x" }).returning({ id: project.id });
    const [n] = await db.insert(narratives).values({ eventCount: 3, content: { chapters: [] }, projectId: p.id, roadmapHtml: "<html></html>" }).returning({ id: narratives.id });
    const [got] = await db.select({ html: narratives.roadmapHtml }).from(narratives).where(eq(narratives.id, n.id));
    assert.equal(got.html, "<html></html>");
  } finally { await close(); }
});
