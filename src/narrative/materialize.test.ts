import test from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { createTestDb } from "../db/client";
import { users, requirements, narratives, events, project } from "../db/schema";
import { emitEvent } from "../db/events";
import { materializeNarrative } from "./materialize";

test("materializeNarrative throws on an empty log", async () => {
  const { db, close } = await createTestDb();
  try {
    await assert.rejects(
      materializeNarrative(db, async () => ({ ok: true, content: { chapters: [] } })),
      /no events/i,
    );
  } finally {
    await close();
  }
});

test("materializeNarrative builds a grounded digest, stores chapters, emits narrative.generated", async () => {
  const { db, close } = await createTestDb();
  try {
    const [proj] = await db
      .insert(project)
      .values({ repoFullName: "acme/repo", defaultBranch: "main", installationId: 1, localClonePath: "/x" })
      .returning({ id: project.id });
    const [u] = await db.insert(users).values({ githubId: 1, githubLogin: "alice" }).returning({ id: users.id });
    const [r] = await db
      .insert(requirements)
      .values({ key: "REQ-003", title: "Event log", description: "d", provenance: "imported", projectId: proj.id })
      .returning({ id: requirements.id });
    await db.transaction((tx) =>
      emitEvent(tx, { type: "requirement.declared", subjectType: "requirement", subjectId: r.id, actorId: u.id, payload: { key: "REQ-003" }, projectId: proj.id }),
    );
    await db.transaction((tx) =>
      emitEvent(tx, { type: "idea.approved", subjectType: "idea", actorId: u.id, payload: {}, rationale: "reached the 2-vote gate", projectId: proj.id }),
    );

    let capturedDigest = "";
    const fakeGen = async (digest: string) => {
      capturedDigest = digest;
      return { ok: true as const, content: { chapters: [{ heading: "Genesis", prose: "It began with the log.", refs: ["REQ-003"] }] } };
    };

    const res = await materializeNarrative(db, fakeGen);
    assert.equal(res.chapters, 1);
    assert.equal(res.eventCount, 2);

    // the digest is chronological, with subject keys and the why woven in
    assert.match(capturedDigest, /alice declared REQ-003/);
    assert.match(capturedDigest, /reached the 2-vote gate/);

    const rows = await db.select().from(narratives);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].eventCount, 2);
    assert.equal(rows[0].projectId, proj.id, "narratives.projectId is set");

    const evs = await db.select().from(events).where(eq(events.type, "narrative.generated"));
    assert.equal(evs.length, 1);
    assert.deepEqual(evs[0].payload, { event_count: 2, chapters: 1 });
    assert.equal(evs[0].projectId, proj.id, "narrative.generated event carries projectId");
  } finally {
    await close();
  }
});
