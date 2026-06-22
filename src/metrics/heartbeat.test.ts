import test from "node:test";
import assert from "node:assert/strict";
import { createTestDb } from "../db/client";
import { events, project } from "../db/schema";
import { heartbeatSeries } from "./heartbeat";

const DAY = 86_400_000;

test("heartbeatSeries buckets events by UTC day into a continuous window", async () => {
  const { db, close } = await createTestDb();
  try {
    const [proj] = await db
      .insert(project)
      .values({ repoFullName: "o/r", installationId: 1, defaultBranch: "main", localClonePath: "/t", specPath: "SPEC.md", claudeMdPath: "CLAUDE.md" })
      .returning({ id: project.id });

    const now = Date.UTC(2026, 5, 20, 12, 0, 0); // midday 2026-06-20 UTC
    const today = Date.UTC(2026, 5, 20);

    // 2 events today, 1 yesterday, 1 outside the 90-day window (ignored)
    await db.insert(events).values([
      { type: "idea.submitted", subjectType: "idea", payload: {}, createdAt: new Date(today + 2 * 3_600_000), projectId: proj.id },
      { type: "idea.voted", subjectType: "idea", payload: {}, createdAt: new Date(today + 5 * 3_600_000), projectId: proj.id },
      { type: "task.claimed", subjectType: "task", payload: {}, createdAt: new Date(today - 1 * DAY + 9 * 3_600_000), projectId: proj.id },
      { type: "project.bound", subjectType: "project", payload: {}, createdAt: new Date(today - 120 * DAY), projectId: proj.id },
    ]);

    const hb = await heartbeatSeries(db, now, 90);
    assert.equal(hb.days.length, 90);
    assert.equal(hb.total, 3); // the 120-days-ago event is outside the window
    assert.equal(hb.activeDays, 2);

    // last bucket is today with 2; previous is yesterday with 1
    const last = hb.days[hb.days.length - 1];
    assert.equal(last.t, today);
    assert.equal(last.count, 2);
    assert.equal(hb.days[hb.days.length - 2].count, 1);

    assert.equal(hb.busiest?.t, today);
    assert.equal(hb.busiest?.count, 2);
  } finally {
    await close();
  }
});

test("heartbeatSeries returns an all-zero window with no busiest when empty", async () => {
  const { db, close } = await createTestDb();
  try {
    const hb = await heartbeatSeries(db, Date.UTC(2026, 5, 20), 30);
    assert.equal(hb.days.length, 30);
    assert.equal(hb.total, 0);
    assert.equal(hb.activeDays, 0);
    assert.equal(hb.busiest, null);
  } finally {
    await close();
  }
});
