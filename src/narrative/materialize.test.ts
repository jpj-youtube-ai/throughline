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

async function seedProjectWithEvent(db: Db, repoFullName: string): Promise<{ projectId: string }> {
  const installationId = Math.floor(Math.random() * 100000);
  const [proj] = await db
    .insert(project)
    .values({ repoFullName, defaultBranch: "main", installationId, localClonePath: `/${repoFullName.replace("/", "-")}` })
    .returning({ id: project.id });
  const githubId = Math.floor(Math.random() * 100000);
  const [u] = await db
    .insert(users)
    .values({ githubId, githubLogin: repoFullName.replace("/", "-") })
    .returning({ id: users.id });
  // Use idea.approved (requires rationale) with a unique rationale so the digest can be inspected
  await db.transaction((tx) =>
    emitEvent(tx, {
      type: "idea.approved",
      subjectType: "idea",
      actorId: u.id,
      payload: {},
      rationale: `approved in ${repoFullName}`,
      projectId: proj.id,
    }),
  );
  return { projectId: proj.id };
}

test("materializeNarrative is a no-op (no throw, no write) when project has no events", async () => {
  const { db, close } = await createTestDb();
  try {
    const [p] = await db
      .insert(project)
      .values({ repoFullName: "a/empty", installationId: 9, defaultBranch: "main", localClonePath: "/x" })
      .returning({ id: project.id });
    const res = await materializeNarrative(db, p.id, async () => ({ ok: true as const, content: { chapters: [] } }), { generateRoadmap: async () => null });
    assert.deepEqual(res, { eventCount: 0, chapters: 0 });
    assert.equal((await db.select().from(narratives).where(eq(narratives.projectId, p.id))).length, 0);
  } finally {
    await close();
  }
});

test("materializeNarrative is scoped to its project (no cross-project events)", async () => {
  const { db, close } = await createTestDb();
  try {
    const a = await seedProjectWithEvent(db, "a/alpha");
    const b = await seedProjectWithEvent(db, "a/beta");
    let capturedDigest = "";
    const fakeGen = async (digest: string) => {
      capturedDigest = digest;
      return { ok: true as const, content: { chapters: [{ heading: "h", prose: "p", refs: [] }] } };
    };
    await materializeNarrative(db, a.projectId, fakeGen, { generateRoadmap: async () => "<html></html>" });
    // narrative row is on project a
    const rows = await db.select().from(narratives).where(eq(narratives.projectId, a.projectId));
    assert.equal(rows.length, 1);
    // digest contains a's rationale marker, not b's (rationale = "approved in a/alpha" vs "approved in a/beta")
    assert.ok(capturedDigest.includes("a/alpha"), `digest should contain a/alpha rationale; got: ${capturedDigest}`);
    assert.ok(!capturedDigest.includes("a/beta"), `digest must not contain a/beta rationale; got: ${capturedDigest}`);
    // no row on project b
    assert.equal((await db.select().from(narratives).where(eq(narratives.projectId, b.projectId))).length, 0);
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

    const res = await materializeNarrative(db, proj.id, fakeGen, { generateRoadmap: async () => null });
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

test("materializeNarrative stores roadmap_html when generation succeeds", async () => {
  const { db, close } = await createTestDb();
  try {
    const ctx = await seedNarratableProject(db);
    await db.insert(requirements).values({ key: "REQ-001", title: "Event log", description: "d", provenance: "imported", status: "shipped", projectId: ctx.projectId });
    let roadmapInput: unknown = null;
    const r = await materializeNarrative(
      db,
      ctx.projectId,
      async () => ({ ok: true, content: { chapters: [{ heading: "H", prose: "p", refs: [] }] } }),
      { generateRoadmap: async (input) => { roadmapInput = input; return "<html><body>roadmap</body></html>"; } },
    );
    assert.ok(r.eventCount > 0);
    const [n] = await db.select({ html: narratives.roadmapHtml }).from(narratives);
    assert.equal(n.html, "<html><body>roadmap</body></html>");
    assert.ok(roadmapInput && (roadmapInput as { requirements: unknown[] }).requirements.length === 1, "real requirements passed");
    const evs = await db.select().from(events).where(eq(events.type, "narrative.generated"));
    assert.equal(evs.length, 1);
  } finally { await close(); }
});

test("materializeNarrative still stores the narrative when the roadmap returns null", async () => {
  const { db, close } = await createTestDb();
  try {
    const ctx = await seedNarratableProject(db);
    const r = await materializeNarrative(
      db,
      ctx.projectId,
      async () => ({ ok: true, content: { chapters: [{ heading: "H", prose: "p", refs: [] }] } }),
      { generateRoadmap: async () => null },
    );
    assert.ok(r.eventCount > 0);
    const [n] = await db.select({ html: narratives.roadmapHtml }).from(narratives);
    assert.equal(n.html, null);
    const evs = await db.select().from(events).where(eq(events.type, "narrative.generated"));
    assert.equal(evs.length, 1, "narrative still generated");
  } finally { await close(); }
});

test("materializeNarrative still stores the narrative when the roadmap generator throws", async () => {
  const { db, close } = await createTestDb();
  try {
    const ctx = await seedNarratableProject(db);
    const r = await materializeNarrative(
      db,
      ctx.projectId,
      async () => ({ ok: true, content: { chapters: [{ heading: "H", prose: "p", refs: [] }] } }),
      { generateRoadmap: async () => { throw new Error("roadmap boom"); } },
    );
    assert.ok(r.eventCount > 0);
    const [n] = await db.select({ html: narratives.roadmapHtml }).from(narratives);
    assert.equal(n.html, null);
  } finally { await close(); }
});
