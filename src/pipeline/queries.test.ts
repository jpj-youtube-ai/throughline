import test from "node:test";
import assert from "node:assert/strict";
import { createTestDb } from "../db/client";
import { users, ideas, requirements, tasks } from "../db/schema";
import { listPipeline } from "./queries";

test("listPipeline buckets ideas and tasks into the five lifecycle stages", async () => {
  const { db, close } = await createTestDb();
  try {
    const [u] = await db.insert(users).values({ githubId: 1, githubLogin: "alice" }).returning({ id: users.id });
    const [r] = await db
      .insert(requirements)
      .values({ key: "REQ-003", title: "Event log", description: "d", provenance: "imported" })
      .returning({ id: requirements.id });

    await db.insert(ideas).values([
      { title: "Voting idea", why: "w", authorId: u.id, state: "voting" },
      { title: "Approved idea", why: "w", authorId: u.id, state: "approved" },
      { title: "Generated idea", why: "w", authorId: u.id, state: "generated" }, // excluded
      { title: "Rejected idea", why: "w", authorId: u.id, state: "rejected" }, // excluded
    ]);
    await db.insert(tasks).values([
      { key: "TASK-001", title: "open", body: "b", requirementId: r.id, effort: 1, risk: "low", confidence: 50, claimState: "unclaimed", githubStatus: "open" },
      { key: "TASK-002", title: "claimed", body: "b", requirementId: r.id, effort: 1, risk: "low", confidence: 50, claimState: "claimed", githubStatus: "open" },
      { key: "TASK-003", title: "merged", body: "b", requirementId: r.id, effort: 1, risk: "low", confidence: 50, claimState: "claimed", githubStatus: "closed" },
    ]);

    const stages = await listPipeline(db);
    const by = Object.fromEntries(stages.map((s) => [s.key, s]));

    assert.deepEqual(
      stages.map((s) => s.key),
      ["voting", "approved", "open", "claimed", "merged"],
    );
    assert.equal(by.voting.count, 1);
    assert.equal(by.voting.items[0].label, "Voting idea");
    assert.equal(by.approved.count, 1);
    assert.equal(by.open.count, 1);
    assert.equal(by.open.items[0].label, "TASK-001");
    assert.equal(by.claimed.count, 1);
    assert.equal(by.claimed.items[0].label, "TASK-002");
    assert.equal(by.merged.count, 1);
    assert.equal(by.merged.items[0].label, "TASK-003");
  } finally {
    await close();
  }
});
