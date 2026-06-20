import test from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { createTestDb, type Db } from "../db/client";
import { requirements, tasks, events } from "../db/schema";
import { reconcileRequirementStatus } from "./lifecycle";
import { handleWebhook } from "../github/webhook";

async function seedReq(db: Db, status: "planned" | "building" | "shipped" = "planned") {
  const [r] = await db
    .insert(requirements)
    .values({ key: "REQ-003", title: "Event log", description: "d", provenance: "imported", status })
    .returning({ id: requirements.id });
  return r.id;
}

async function addTask(db: Db, reqId: string, key: string, github: "open" | "closed" = "open") {
  const [t] = await db
    .insert(tasks)
    .values({ key, title: key, body: "b", requirementId: reqId, effort: 1, risk: "low", confidence: 50, githubStatus: github })
    .returning({ id: tasks.id });
  return t.id;
}

async function statusChanges(db: Db) {
  return db.select().from(events).where(eq(events.type, "requirement.status_changed"));
}

test("reconcileRequirementStatus: planned with an open task → building (with event)", async () => {
  const { db, close } = await createTestDb();
  try {
    const reqId = await seedReq(db, "planned");
    await addTask(db, reqId, "TASK-001", "open");
    const out = await db.transaction((tx) => reconcileRequirementStatus(tx, reqId));
    assert.equal(out, "building");
    assert.equal((await db.select().from(requirements).where(eq(requirements.id, reqId)))[0].status, "building");
    const evs = await statusChanges(db);
    assert.equal(evs.length, 1);
    assert.deepEqual(evs[0].payload, { from: "planned", to: "building" });
  } finally {
    await close();
  }
});

test("reconcileRequirementStatus: ships only when every task is merged; idempotent; no tasks = no change", async () => {
  const { db, close } = await createTestDb();
  try {
    const reqId = await seedReq(db, "building");

    // no tasks → stays as-is, no event
    assert.equal(await db.transaction((tx) => reconcileRequirementStatus(tx, reqId)), null);

    const t1 = await addTask(db, reqId, "TASK-001", "closed");
    await addTask(db, reqId, "TASK-002", "open");
    // one still open → not shipped
    assert.equal(await db.transaction((tx) => reconcileRequirementStatus(tx, reqId)), null);

    await db.update(tasks).set({ githubStatus: "closed" }).where(eq(tasks.id, t1)); // (already closed)
    await db.update(tasks).set({ githubStatus: "closed" }).where(eq(tasks.requirementId, reqId));
    const out = await db.transaction((tx) => reconcileRequirementStatus(tx, reqId));
    assert.equal(out, "shipped");

    // idempotent: already shipped → no further change/event
    assert.equal(await db.transaction((tx) => reconcileRequirementStatus(tx, reqId)), null);
    const evs = await statusChanges(db);
    assert.equal(evs.length, 1);
    assert.deepEqual(evs[0].payload, { from: "building", to: "shipped" });
  } finally {
    await close();
  }
});

test("a merged PR for the last task ships its requirement (webhook integration)", async () => {
  const { db, close } = await createTestDb();
  try {
    const reqId = await seedReq(db, "building");
    await addTask(db, reqId, "TASK-007", "open");

    const res = await handleWebhook(db, "pull_request", {
      action: "closed",
      pull_request: { merged: true, title: "[TASK-007] Ship it" },
    });
    assert.equal(res.changed, true);
    assert.equal((await db.select().from(requirements).where(eq(requirements.id, reqId)))[0].status, "shipped");

    const evs = await statusChanges(db);
    assert.equal(evs.length, 1);
    assert.deepEqual(evs[0].payload, { from: "building", to: "shipped" });
  } finally {
    await close();
  }
});
