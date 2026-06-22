import test from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { createTestDb, type Db } from "../db/client";
import { users, project, events } from "../db/schema";
import { emitEvent } from "../db/events";
import { generateDigest } from "./send";

async function seedProjectWithActivity(db: Db): Promise<string> {
  const [proj] = await db
    .insert(project)
    .values({ repoFullName: "acme/repo", defaultBranch: "main", installationId: 1, localClonePath: "/x" })
    .returning({ id: project.id });
  const [u] = await db.insert(users).values({ githubId: 1, githubLogin: "alice" }).returning({ id: users.id });
  await db.transaction((tx) =>
    emitEvent(tx, { type: "idea.approved", subjectType: "idea", actorId: u.id, payload: {}, rationale: "reached the gate", projectId: proj.id }),
  );
  return proj.id;
}

test("generateDigest composes, records digest.generated, and advances the watermark", async () => {
  const { db, close } = await createTestDb();
  try {
    const projId = await seedProjectWithActivity(db);
    const fakeCompose = async () => ({ ok: true as const, text: "Alice approved an idea." });

    const res = await generateDigest(db, { compose: fakeCompose });
    assert.equal(res.generated, true);
    assert.equal(res.generated && res.text, "Alice approved an idea.");

    const gen = await db.select().from(events).where(eq(events.type, "digest.generated"));
    assert.equal(gen.length, 1);
    assert.equal((gen[0].payload as { event_count: number }).event_count, 1);
    assert.equal(gen[0].projectId, projId, "digest.generated event carries projectId");

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

test("generateDigest with projectId only composes that project's activity, not the other project's", async () => {
  const { db, close } = await createTestDb();
  try {
    // Project A — seed activity
    const [projA] = await db
      .insert(project)
      .values({ repoFullName: "acme/alpha", defaultBranch: "main", installationId: 10, localClonePath: "/a" })
      .returning({ id: project.id });
    const [uA] = await db.insert(users).values({ githubId: 10, githubLogin: "alice" }).returning({ id: users.id });
    await db.transaction((tx) =>
      emitEvent(tx, { type: "idea.approved", subjectType: "idea", actorId: uA.id, payload: {}, rationale: "alpha decision", projectId: projA.id }),
    );

    // Project B — seed different activity
    const [projB] = await db
      .insert(project)
      .values({ repoFullName: "acme/beta", defaultBranch: "main", installationId: 20, localClonePath: "/b" })
      .returning({ id: project.id });
    const [uB] = await db.insert(users).values({ githubId: 20, githubLogin: "bob" }).returning({ id: users.id });
    await db.transaction((tx) =>
      emitEvent(tx, { type: "idea.submitted", subjectType: "idea", actorId: uB.id, payload: {}, rationale: "beta idea", projectId: projB.id }),
    );

    let capturedDigest = "";
    const fakeCompose = async (args: { eventDigest: string }) => {
      capturedDigest = args.eventDigest;
      return { ok: true as const, text: "B only digest" };
    };

    const res = await generateDigest(db, { projectId: projB.id, compose: fakeCompose });
    assert.equal(res.generated, true);

    // The composed input must include B's event (bob/idea.submitted) but not A's (alice/idea.approved)
    assert.match(capturedDigest, /bob/, "composed input must include project B's actor");
    assert.doesNotMatch(capturedDigest, /alice/, "composed input must not include project A's actor");

    // The digest.generated event must be scoped to project B
    const genEvents = await db.select().from(events).where(eq(events.type, "digest.generated"));
    assert.equal(genEvents.length, 1);
    assert.equal(genEvents[0].projectId, projB.id, "digest.generated event must be scoped to project B");
  } finally {
    await close();
  }
});
