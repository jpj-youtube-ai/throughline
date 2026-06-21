import test from "node:test";
import assert from "node:assert/strict";
import { createTestDb } from "../db/client";
import { events } from "../db/schema";
import { countRationales } from "./queries";

test("countRationales counts only events carrying a why", async () => {
  const { db, close } = await createTestDb();
  try {
    assert.equal(await countRationales(db), 0);
    await db.insert(events).values([
      { type: "idea.submitted", subjectType: "idea", payload: {}, rationale: "a why" },
      { type: "idea.approved", subjectType: "idea", payload: {}, rationale: "another" },
      { type: "task.claimed", subjectType: "task", payload: {}, rationale: null },
    ]);
    assert.equal(await countRationales(db), 2);
  } finally {
    await close();
  }
});
