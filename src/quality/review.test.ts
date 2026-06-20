import test from "node:test";
import assert from "node:assert/strict";
import { createTestDb, type Db } from "../db/client";
import { users } from "../db/schema";
import { emitEvent } from "../db/events";
import { reviewWhyQuality, type RationaleItem } from "./review";

async function seedDecisions(db: Db) {
  const [u] = await db.insert(users).values({ githubId: 1, githubLogin: "alice" }).returning({ id: users.id });
  await db.transaction((tx) =>
    emitEvent(tx, { type: "idea.submitted", subjectType: "idea", actorId: u.id, payload: {}, rationale: "it would be good" }),
  );
  await db.transaction((tx) =>
    emitEvent(tx, {
      type: "idea.approved",
      subjectType: "idea",
      actorId: u.id,
      payload: {},
      rationale: "cuts review time in half by removing the manual triage step",
    }),
  );
}

test("reviewWhyQuality grades rationale-bearing decisions, worst-first, with an average", async () => {
  const { db, close } = await createTestDb();
  try {
    await seedDecisions(db);

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

    const review = await reviewWhyQuality(db, fakeGrade);
    assert.ok(review.ok);
    if (!review.ok) return;

    assert.equal(review.count, 2);
    // both rationales reached the grader
    assert.equal(received.length, 2);
    // worst-first: the vague "it would be good" comes first
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
    await seedDecisions(db);
    const review = await reviewWhyQuality(db, async () => ({ ok: false as const, failure: "API error: out of credits" }));
    assert.equal(review.ok, false);
    if (!review.ok) assert.match(review.failure, /out of credits/);
  } finally {
    await close();
  }
});

test("reviewWhyQuality returns an empty review when no decisions carry a why", async () => {
  const { db, close } = await createTestDb();
  try {
    const review = await reviewWhyQuality(db, async () => ({ ok: true as const, grades: [] }));
    assert.ok(review.ok);
    if (review.ok) assert.equal(review.count, 0);
  } finally {
    await close();
  }
});
