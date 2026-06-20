import test from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { createTestDb, type Db } from "../db/client";
import { users, project, events } from "../db/schema";
import { emitEvent } from "../db/events";
import { dueForDigest, scheduleToDays, sendDigest } from "./send";

const DAY = 86_400_000;

test("scheduleToDays parses named and numeric schedules", () => {
  assert.equal(scheduleToDays("weekly"), 7);
  assert.equal(scheduleToDays("Daily"), 1);
  assert.equal(scheduleToDays("14"), 14);
  assert.equal(scheduleToDays(""), null);
  assert.equal(scheduleToDays("nonsense"), null);
  assert.equal(scheduleToDays("0"), null);
});

test("dueForDigest respects the schedule and the last-sent watermark", () => {
  const now = Date.UTC(2026, 5, 20);
  assert.equal(dueForDigest(null, null, now), false); // unscheduled → never
  assert.equal(dueForDigest("weekly", null, now), true); // first one due once scheduled
  assert.equal(dueForDigest("weekly", new Date(now - 3 * DAY), now), false); // too soon
  assert.equal(dueForDigest("weekly", new Date(now - 8 * DAY), now), true); // overdue
});

async function seedProjectWithWebhook(db: Db, url: string | null) {
  await db.insert(project).values({
    repoFullName: "acme/repo",
    defaultBranch: "main",
    installationId: 1,
    localClonePath: "/x",
    digestWebhookUrl: url,
    digestSchedule: "weekly",
  });
  const [u] = await db.insert(users).values({ githubId: 1, githubLogin: "alice" }).returning({ id: users.id });
  await db.transaction((tx) =>
    emitEvent(tx, { type: "idea.approved", subjectType: "idea", actorId: u.id, payload: {}, rationale: "reached the gate" }),
  );
}

test("sendDigest composes, posts to the webhook, and records digest.sent", async () => {
  const { db, close } = await createTestDb();
  try {
    await seedProjectWithWebhook(db, "https://hooks.example/abc");

    const posts: { url: string; text: string }[] = [];
    const fakePost = async (url: string, text: string) => {
      posts.push({ url, text });
    };
    const fakeCompose = async () => ({ ok: true as const, text: "Alice approved an idea." });

    const res = await sendDigest(db, { compose: fakeCompose, post: fakePost });
    assert.equal(res.sent, true);
    assert.equal(posts.length, 1);
    assert.equal(posts[0].url, "https://hooks.example/abc");
    assert.equal(posts[0].text, "Alice approved an idea.");

    const sent = await db.select().from(events).where(eq(events.type, "digest.sent"));
    assert.equal(sent.length, 1);
    assert.equal((sent[0].payload as { event_count: number }).event_count, 1);

    // immediately after, nothing new → no second send (watermark advanced)
    const again = await sendDigest(db, { compose: fakeCompose, post: fakePost });
    assert.equal(again.sent, false);
    assert.equal(posts.length, 1);
  } finally {
    await close();
  }
});

test("sendDigest sends nothing when no webhook is configured, and never records on compose failure", async () => {
  const { db, close } = await createTestDb();
  try {
    await seedProjectWithWebhook(db, null); // no webhook
    const noUrl = await sendDigest(db, { compose: async () => ({ ok: true as const, text: "x" }), post: async () => {} });
    assert.equal(noUrl.sent, false);
    assert.match(noUrl.reason ?? "", /no digest webhook/i);

    // now give it a webhook but fail compose — must not post or record
    await db.update(project).set({ digestWebhookUrl: "https://hooks.example/abc" });
    let posted = false;
    const res = await sendDigest(db, {
      compose: async () => ({ ok: false as const, failure: "API error" }),
      post: async () => {
        posted = true;
      },
    });
    assert.equal(res.sent, false);
    assert.equal(posted, false);
    assert.equal((await db.select().from(events).where(eq(events.type, "digest.sent"))).length, 0);
  } finally {
    await close();
  }
});
