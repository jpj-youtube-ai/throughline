import test from "node:test";
import assert from "node:assert/strict";
import { createTestDb } from "./client";
import { project, narratives } from "./schema";
import { eq } from "drizzle-orm";

test("narratives.roadmap_html / roadmap_image round-trip", async () => {
  const { db, close } = await createTestDb();
  try {
    const [p] = await db.insert(project).values({ repoFullName: "a/b", installationId: 1, defaultBranch: "main", localClonePath: "/x" }).returning({ id: project.id });
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 7, 7]);
    const [n] = await db.insert(narratives).values({ eventCount: 3, content: { chapters: [] }, projectId: p.id, roadmapHtml: "<html></html>", roadmapImage: png }).returning({ id: narratives.id });
    const [got] = await db.select({ html: narratives.roadmapHtml, img: narratives.roadmapImage }).from(narratives).where(eq(narratives.id, n.id));
    assert.equal(got.html, "<html></html>");
    assert.deepEqual(Buffer.from(got.img as Uint8Array), png);
  } finally { await close(); }
});
