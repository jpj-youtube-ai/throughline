import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { createTestDb, type Db } from "../db/client";
import { requirements, tasks, events, project } from "../db/schema";
import { verifySignature, handleWebhook } from "./webhook";

async function seedProject(db: Db): Promise<string> {
  const [proj] = await db
    .insert(project)
    .values({ repoFullName: "acme/repo", defaultBranch: "main", installationId: 1, localClonePath: "/x" })
    .returning({ id: project.id });
  return proj.id;
}

async function requirementId(db: Db): Promise<string> {
  const [req] = await db
    .insert(requirements)
    .values({ key: "REQ-001", title: "t", description: "d", provenance: "imported" })
    .returning({ id: requirements.id });
  return req.id;
}

async function addTask(
  db: Db,
  reqId: string,
  key: string,
  issueNumber: number | null,
  projId?: string,
): Promise<void> {
  await db.insert(tasks).values({
    key,
    title: key,
    body: "b",
    requirementId: reqId,
    effort: 1,
    risk: "low",
    confidence: 50,
    githubIssueNumber: issueNumber,
    projectId: projId,
  });
}

test("verifySignature accepts a correct HMAC and rejects everything else", () => {
  const secret = "shh";
  const body = '{"hello":"world"}';
  const good = "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");
  assert.equal(verifySignature(secret, body, good), true);
  assert.equal(verifySignature(secret, body, "sha256=deadbeef"), false);
  assert.equal(verifySignature(secret, body, null), false);
  assert.equal(verifySignature(undefined, body, good), false);
});

test("issues closed/reopened mirror github_status and emit the change; unknown issue is a no-op", async () => {
  const { db, close } = await createTestDb();
  try {
    const projId = await seedProject(db);
    const reqId = await requirementId(db);
    await addTask(db, reqId, "TASK-001", 42, projId);

    const r1 = await handleWebhook(db, "issues", { action: "closed", issue: { number: 42 } });
    assert.deepEqual(r1, { changed: true, taskKey: "TASK-001", to: "closed" });
    assert.equal((await db.select().from(tasks).where(eq(tasks.key, "TASK-001")))[0].githubStatus, "closed");
    const evs = await db.select().from(events).where(eq(events.type, "task.github_status_changed"));
    assert.equal(evs.length, 1);
    assert.deepEqual(evs[0].payload, { from: "open", to: "closed" });
    assert.equal(evs[0].projectId, projId, "task.github_status_changed event carries projectId");

    const r2 = await handleWebhook(db, "issues", { action: "reopened", issue: { number: 42 } });
    assert.equal(r2.to, "open");
    assert.equal((await db.select().from(tasks).where(eq(tasks.key, "TASK-001")))[0].githubStatus, "open");

    // Re-closing emits again; a no-change delivery does not.
    const r3 = await handleWebhook(db, "issues", { action: "closed", issue: { number: 42 } });
    assert.equal(r3.changed, true);
    const r4 = await handleWebhook(db, "issues", { action: "closed", issue: { number: 42 } });
    assert.equal(r4.changed, false, "already closed — no duplicate event");

    // Unknown issue number → no-op.
    const r5 = await handleWebhook(db, "issues", { action: "closed", issue: { number: 999 } });
    assert.equal(r5.changed, false);
  } finally {
    await close();
  }
});

test("a merged PR titled [TASK-NNN] closes that task; a non-merged PR does not", async () => {
  const { db, close } = await createTestDb();
  try {
    const projId = await seedProject(db);
    const reqId = await requirementId(db);
    await addTask(db, reqId, "TASK-005", null, projId);

    const r = await handleWebhook(db, "pull_request", {
      action: "closed",
      pull_request: { merged: true, title: "[TASK-005] implement the thing" },
    });
    assert.deepEqual(r, { changed: true, taskKey: "TASK-005", to: "closed" });
    assert.equal((await db.select().from(tasks).where(eq(tasks.key, "TASK-005")))[0].githubStatus, "closed");
    const prEvs = await db.select().from(events).where(eq(events.type, "task.github_status_changed"));
    assert.equal(prEvs.length, 1);
    assert.equal(prEvs[0].projectId, projId, "PR-triggered event carries projectId");

    const r2 = await handleWebhook(db, "pull_request", {
      action: "closed",
      pull_request: { merged: false, title: "[TASK-006] abandoned" },
    });
    assert.equal(r2.changed, false);
  } finally {
    await close();
  }
});
