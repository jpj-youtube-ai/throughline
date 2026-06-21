import test from "node:test";
import assert from "node:assert/strict";
import { createTestDb } from "../db/client";
import { events } from "../db/schema";
import { digestSummary } from "./queries";

test("digestSummary returns zero/null with no digest events", async () => {
  const { db, close } = await createTestDb();
  try {
    const s = await digestSummary(db);
    assert.deepEqual(s, { count: 0, lastSentAt: null });
  } finally {
    await close();
  }
});

test("digestSummary counts digest.sent and reports the latest", async () => {
  const { db, close } = await createTestDb();
  try {
    await db.insert(events).values([
      { type: "digest.sent", subjectType: "project", payload: {}, createdAt: new Date(1000) },
      { type: "digest.sent", subjectType: "project", payload: {}, createdAt: new Date(3000) },
      { type: "idea.submitted", subjectType: "idea", payload: {}, rationale: "x", createdAt: new Date(2000) },
    ]);
    const s = await digestSummary(db);
    assert.equal(s.count, 2);
    assert.equal(s.lastSentAt?.getTime(), 3000);
  } finally {
    await close();
  }
});
