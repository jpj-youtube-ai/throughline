import test from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { createTestDb, type Db } from "../db/client";
import { users, project, events } from "../db/schema";
import { emitEvent } from "../db/events";
import { generateDigest } from "./send";

async function seedProjectWithActivity(db: Db) {
  await db.insert(project).values({
    repoFullName: "acme/repo",
    defaultBranch: "main",
    installationId: 1,
    localClonePath: "/x",
  });
  const [u] = await db.insert(users).values({ githubId: 1, githubLogin: "alice" }).returning({ id: users.id });
  await db.transaction((tx) =>
    emitEvent(tx, { type: "idea.approved", subjectType: "idea", actorId: u.id, payload: {}, rationale: "reached the gate" }),
  );
}

test("generateDigest composes, records digest.generated, and advances the watermark", async () => {
  const { db, close } = await createTestDb();
  try {
    await seedProjectWithActivity(db);
    const fakeCompose = async () => ({ ok: true as const, text: "Alice approved an idea." });

    const res = await generateDigest(db, { compose: fakeCompose });
    assert.equal(res.generated, true);
    assert.equal(res.generated && res.text, "Alice approved an idea.");

    const gen = await db.select().from(events).where(eq(events.type, "digest.generated"));
    assert.equal(gen.length, 1);
    assert.equal((gen[0].payload as { event_count: number }).event_count, 1);

    // nothing new now → no second record (watermark advanced)
    const again = await generateDigest(db, { compose: fakeCompose });
    assert.equal(again.generated, false);
    assert.equal((await db.select().from(events).where(eq(events.type, "digest.generated"))).length, 1);
  } finally {
    await close();
  }
});

test("generateDigest records nothing on an empty window", async () => {
  const { db, close } = await createTestDb();
  try {
    await db.insert(project).values({ repoFullName: "acme/repo", defaultBranch: "main", installationId: 1, localClonePath: "/x" });
    const res = await generateDigest(db, { compose: async () => ({ ok: true as const, text: "x" }) });
    assert.equal(res.generated, false);
    assert.match(res.reason ?? "", /nothing new/i);
    assert.equal((await db.select().from(events).where(eq(events.type, "digest.generated"))).length, 0);
  } finally {
    await close();
  }
});

test("generateDigest records nothing on compose failure", async () => {
  const { db, close } = await createTestDb();
  try {
    await seedProjectWithActivity(db);
    const res = await generateDigest(db, { compose: async () => ({ ok: false as const, failure: "API error" }) });
    assert.equal(res.generated, false);
    assert.equal((await db.select().from(events).where(eq(events.type, "digest.generated"))).length, 0);
  } finally {
    await close();
  }
});
