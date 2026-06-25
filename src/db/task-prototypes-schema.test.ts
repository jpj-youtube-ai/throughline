import test from "node:test";
import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import { createTestDb } from "./client";
import { project, prototypes, tasks, requirements, taskPrototypes } from "./schema";

test("task_prototypes links a task to a prototype, cascades on delete", async () => {
  const { db, close } = await createTestDb();
  try {
    const [p] = await db.insert(project).values({ repoFullName: "a/b", installationId: 1, defaultBranch: "main", localClonePath: "/x" }).returning({ id: project.id });
    const [r] = await db.insert(requirements).values({ key: "REQ-001", title: "t", description: "d", status: "planned", provenance: "voted", projectId: p.id }).returning({ id: requirements.id });
    const [t] = await db.insert(tasks).values({ key: "TASK-001", title: "UI", body: "b", requirementId: r.id, effort: 1, risk: "low", confidence: 50, projectId: p.id }).returning({ id: tasks.id });
    const [proto] = await db.insert(prototypes).values({ projectId: p.id, label: "Home", html: "<h1>h</h1>" }).returning({ id: prototypes.id });

    await db.insert(taskPrototypes).values({ taskId: t.id, prototypeId: proto.id });
    const links = await db.select().from(taskPrototypes).where(and(eq(taskPrototypes.taskId, t.id), eq(taskPrototypes.prototypeId, proto.id)));
    assert.equal(links.length, 1);

    // deleting the prototype cascades the link away
    await db.delete(prototypes).where(eq(prototypes.id, proto.id));
    assert.equal((await db.select().from(taskPrototypes).where(eq(taskPrototypes.taskId, t.id))).length, 0);
  } finally { await close(); }
});
