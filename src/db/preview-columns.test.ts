import test from "node:test";
import assert from "node:assert/strict";
import { createTestDb } from "./client";
import { project, requirements, tasks } from "./schema";
import { eq } from "drizzle-orm";

test("tasks.preview_html / preview_image round-trip", async () => {
  const { db, close } = await createTestDb();
  try {
    const [p] = await db.insert(project).values({ repoFullName: "a/b", installationId: 1, defaultBranch: "main", localClonePath: "/x" }).returning({ id: project.id });
    const [r] = await db.insert(requirements).values({ key: "REQ-001", title: "t", description: "d", provenance: "imported", projectId: p.id }).returning({ id: requirements.id });
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    const [t] = await db.insert(tasks).values({
      key: "TASK-001", title: "t", body: "b", requirementId: r.id, effort: 1, risk: "low", confidence: 50,
      projectId: p.id, previewHtml: "<html></html>", previewImage: png,
    }).returning({ id: tasks.id });
    const [got] = await db.select({ html: tasks.previewHtml, img: tasks.previewImage }).from(tasks).where(eq(tasks.id, t.id));
    assert.equal(got.html, "<html></html>");
    assert.deepEqual(Buffer.from(got.img as Uint8Array), png);
  } finally { await close(); }
});
