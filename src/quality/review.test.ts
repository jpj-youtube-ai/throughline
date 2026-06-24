import test from "node:test";
import assert from "node:assert/strict";
import { createTestDb, type Db } from "../db/client";
import { users, project } from "../db/schema";
import { emitEvent } from "../db/events";
import { reviewWhyQuality, type RationaleItem } from "./review";

async function seedDecisions(db: Db): Promise<{ projectId: string }> {
  const [proj] = await db
    .insert(project)
    .values({ repoFullName: "o/r", installationId: 1, defaultBranch: "main", localClonePath: "/t", specPath: "SPEC.md", claudeMdPath: "CLAUDE.md" })
    .returning({ id: project.id });
  const [u] = await db.insert(users).values({ githubId: 1, githubLogin: "alice" }).returning({ id: users.id });
  await db.transaction((tx) =>
    emitEvent(tx, { type: "idea.submitted", subjectType: "idea", actorId: u.id, payload: {}, rationale: "it would be good", projectId: proj.id }),
  );
  await db.transaction((tx) =>
    emitEvent(tx, {
      type: "idea.approved",
      subjectType: "idea",
      actorId: u.id,
      payload: {},
      rationale: "cuts review time in half by removing the manual triage step",
      projectId: proj.id,
    }),
  );
  return { projectId: proj.id };
}

test("reviewWhyQuality grades rationale-bearing decisions, worst-first, with an average", async () => {
  const { db, close } = await createTestDb();
  try {
    const { projectId } = await seedDecisions(db);

    // fake grader: short rationales score low; mirror ids back
    let received: RationaleItem[] = [];
    const fakeGrade = async (items: RationaleItem[]) => {
      received = items;
      return {
        ok: true as const,
        grades: items.map((it) => ({
          id: it.id,
          score: it.rationale.length < 30 ? 30 : 85,
          critique: it.rationale.length < 30 ? "too vague" : "concrete and clear",
        })),
      };
    };

    const review = await reviewWhyQuality(db, projectId, fakeGrade);
    assert.ok(review.ok);
    if (!review.ok) return;

    assert.equal(review.count, 2);
    assert.equal(received.length, 2);
    assert.match(review.items[0].rationale, /would be good/);
    assert.equal(review.items[0].score, 30);
    assert.equal(review.items[1].score, 85);
    assert.equal(review.average, 58); // round((30+85)/2)
  } finally {
    await close();
  }
});

test("reviewWhyQuality surfaces a grader failure", async () => {
  const { db, close } = await createTestDb();
  try {
    const { projectId } = await seedDecisions(db);
    const review = await reviewWhyQuality(db, projectId, async () => ({ ok: false as const, failure: "API error: out of credits" }));
    assert.equal(review.ok, false);
    if (!review.ok) assert.match(review.failure, /out of credits/);
  } finally {
    await close();
  }
});

test("reviewWhyQuality returns an empty review when no decisions carry a why", async () => {
  const { db, close } = await createTestDb();
  try {
    const [proj] = await db
      .insert(project)
      .values({ repoFullName: "o/empty", installationId: 1, defaultBranch: "main", localClonePath: "/e" })
      .returning({ id: project.id });
    const review = await reviewWhyQuality(db, proj.id, async () => ({ ok: true as const, grades: [] }));
    assert.ok(review.ok);
    if (review.ok) assert.equal(review.count, 0);
  } finally {
    await close();
  }
});

test("reviewWhyQuality is scoped to the project — another project's rationales are excluded", async () => {
  const { db, close } = await createTestDb();
  try {
    const a = await seedDecisions(db); // project A: 2 rationale-bearing decisions
    const [projB] = await db
      .insert(project)
      .values({ repoFullName: "o/b", installationId: 2, defaultBranch: "main", localClonePath: "/b" })
      .returning({ id: project.id });
    const [u] = await db.insert(users).values({ githubId: 2, githubLogin: "bob" }).returning({ id: users.id });
    await db.transaction((tx) =>
      emitEvent(tx, { type: "idea.approved", subjectType: "idea", actorId: u.id, payload: {}, rationale: "B-only reasoning that should not appear in A's review", projectId: projB.id }),
    );

    let received: RationaleItem[] = [];
    const grade = async (items: RationaleItem[]) => {
      received = items;
      return { ok: true as const, grades: items.map((it) => ({ id: it.id, score: 70, critique: "ok" })) };
    };

    const review = await reviewWhyQuality(db, a.projectId, grade);
    assert.ok(review.ok);
    if (!review.ok) return;
    assert.equal(review.count, 2, "only project A's two rationales are graded");
    assert.ok(!received.some((r) => r.rationale.includes("B-only")), "project B's rationale is excluded");
  } finally {
    await close();
  }
});
