import test from "node:test";
import assert from "node:assert/strict";
import { createTestDb } from "../db/client";
import { project, requirements, tasks } from "../db/schema";
import { getPreviewPng } from "./serve";

test("getPreviewPng returns the stored PNG, or null when absent", async () => {
  const { db, close } = await createTestDb();
  try {
    const [p] = await db.insert(project).values({ repoFullName: "a/b", installationId: 1, defaultBranch: "main", localClonePath: "/x" }).returning({ id: project.id });
    const [r] = await db.insert(requirements).values({ key: "REQ-001", title: "t", description: "d", provenance: "imported", projectId: p.id }).returning({ id: requirements.id });
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 9]);
    const [withImg] = await db.insert(tasks).values({ key: "TASK-001", title: "t", body: "b", requirementId: r.id, effort: 1, risk: "low", confidence: 50, projectId: p.id, previewImage: png }).returning({ id: tasks.id });
    const [noImg] = await db.insert(tasks).values({ key: "TASK-002", title: "t", body: "b", requirementId: r.id, effort: 1, risk: "low", confidence: 50, projectId: p.id }).returning({ id: tasks.id });
    assert.deepEqual((await getPreviewPng(db, withImg.id)) && Buffer.from((await getPreviewPng(db, withImg.id))!), png);
    assert.equal(await getPreviewPng(db, noImg.id), null);
    assert.equal(await getPreviewPng(db, "00000000-0000-0000-0000-000000000000"), null);
  } finally { await close(); }
});
