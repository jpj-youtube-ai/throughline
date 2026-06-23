import test from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { createTestDb } from "../db/client";
import { users, requirements, narratives, events, project } from "../db/schema";
import { emitEvent } from "../db/events";
import { materializeNarrative } from "./materialize";
import type { Db } from "../db/client";

async function seedNarratableProject(db: Db): Promise<{ projectId: string }> {
  const [proj] = await db
    .insert(project)
    .values({ repoFullName: "acme/seed", defaultBranch: "main", installationId: 99, localClonePath: "/seed" })
    .returning({ id: project.id });
  const [u] = await db.insert(users).values({ githubId: 99, githubLogin: "seeder" }).returning({ id: users.id });
  await db.transaction((tx) =>
    emitEvent(tx, { type: "idea.approved", subjectType: "idea", actorId: u.id, payload: {}, rationale: "voted in", projectId: proj.id }),
  );
  return { projectId: proj.id };
}

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

    const res = await materializeNarrative(db, fakeGen, { generateRoadmap: async () => null });
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

test("materializeNarrative stores a roadmap image when generation succeeds", async () => {
  const { db, close } = await createTestDb();
  try {
    const ctx = await seedNarratableProject(db); // returns { projectId }
    await db.insert(requirements).values({ key: "REQ-001", title: "Event log", description: "d", provenance: "imported", status: "shipped", projectId: ctx.projectId });
    let roadmapInput: unknown = null;
    const r = await materializeNarrative(
      db,
      async () => ({ ok: true, content: { chapters: [{ heading: "H", prose: "p", refs: [] }] } }),
      {
        generateRoadmap: async (input) => { roadmapInput = input; return "<html><body>roadmap</body></html>"; },
        renderPng: async () => Buffer.from([0x89, 0x50, 0x4e, 0x47, 1]),
      },
    );
    assert.ok(r.eventCount > 0);
    const [n] = await db.select({ img: narratives.roadmapImage, html: narratives.roadmapHtml }).from(narratives);
    assert.ok(n.img && n.html, "roadmap stored");
    assert.ok(roadmapInput && (roadmapInput as { requirements: unknown[] }).requirements.length === 1, "real requirements passed to the roadmap");
    const evs = await db.select().from(events).where(eq(events.type, "narrative.generated"));
    assert.equal(evs.length, 1);
  } finally { await close(); }
});

test("materializeNarrative still stores the narrative when the roadmap fails", async () => {
  const { db, close } = await createTestDb();
  try {
    const ctx = await seedNarratableProject(db);
    const r = await materializeNarrative(
      db,
      async () => ({ ok: true, content: { chapters: [{ heading: "H", prose: "p", refs: [] }] } }),
      { generateRoadmap: async () => null, renderPng: async () => { throw new Error("should not run"); } },
    );
    assert.ok(r.eventCount > 0);
    const [n] = await db.select({ img: narratives.roadmapImage }).from(narratives);
    assert.equal(n.img, null, "no image stored");
    const evs = await db.select().from(events).where(eq(events.type, "narrative.generated"));
    assert.equal(evs.length, 1, "narrative still generated");
  } finally { await close(); }
});

test("materializeNarrative still stores the narrative when render throws", async () => {
  const { db, close } = await createTestDb();
  try {
    const ctx = await seedNarratableProject(db);
    const r = await materializeNarrative(
      db,
      async () => ({ ok: true, content: { chapters: [{ heading: "H", prose: "p", refs: [] }] } }),
      { generateRoadmap: async () => "<html><body>x</body></html>", renderPng: async () => { throw new Error("chromium boom"); } },
    );
    assert.ok(r.eventCount > 0);
    const [n] = await db.select({ img: narratives.roadmapImage }).from(narratives);
    assert.equal(n.img, null);
  } finally { await close(); }
});
