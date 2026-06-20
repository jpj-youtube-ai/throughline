import test from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { createTestDb } from "./client";
import { emitEvent } from "./events";
import { users, events } from "./schema";

// Drizzle wraps the database error as "Failed query: …" and puts the Postgres
// error (with our trigger's message) in `.cause`. Check the whole chain.
function mentionsAppendOnly(err: unknown): boolean {
  const cause = err instanceof Error ? (err.cause as unknown) : undefined;
  const text = `${err instanceof Error ? err.message : String(err)} ${
    cause instanceof Error ? cause.message : String(cause ?? "")
  }`;
  return /append-only/i.test(text);
}

test("emitEvent writes exactly one event row inside a transaction", async () => {
  const { db, close } = await createTestDb();
  try {
    await db.transaction(async (tx) => {
      await emitEvent(tx, { type: "idea.voted", subjectType: "idea", payload: { voter: "u1" } });
    });
    const rows = await db.select().from(events);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].type, "idea.voted");
    assert.deepEqual(rows[0].payload, { voter: "u1" });
  } finally {
    await close();
  }
});

test("state write + event commit atomically; both roll back together on error", async () => {
  const { db, close } = await createTestDb();
  try {
    // A failing transaction must persist neither the state row nor the event.
    await assert.rejects(
      db.transaction(async (tx) => {
        await tx.insert(users).values({ githubId: 1, githubLogin: "alice" });
        await emitEvent(tx, { type: "idea.voted", subjectType: "idea" });
        throw new Error("boom");
      }),
    );
    assert.equal((await db.select().from(users)).length, 0, "user rolled back");
    assert.equal((await db.select().from(events)).length, 0, "event rolled back");

    // A committing transaction persists both, together.
    await db.transaction(async (tx) => {
      await tx.insert(users).values({ githubId: 2, githubLogin: "bob" });
      await emitEvent(tx, { type: "idea.voted", subjectType: "idea" });
    });
    assert.equal((await db.select().from(users)).length, 1);
    assert.equal((await db.select().from(events)).length, 1);
  } finally {
    await close();
  }
});

test("rationale-required event without a rationale is rejected and not persisted", async () => {
  const { db, close } = await createTestDb();
  try {
    await assert.rejects(
      db.transaction(async (tx) => {
        await emitEvent(tx, { type: "idea.submitted", subjectType: "idea" });
      }),
      /requires a rationale/,
    );
    assert.equal((await db.select().from(events)).length, 0);
  } finally {
    await close();
  }
});

test("events is append-only: UPDATE and DELETE are rejected at the database", async () => {
  const { db, close } = await createTestDb();
  try {
    await db.transaction(async (tx) => {
      await emitEvent(tx, { type: "idea.voted", subjectType: "idea" });
    });
    await assert.rejects(db.execute(sql`update events set rationale = 'tamper'`), mentionsAppendOnly);
    await assert.rejects(db.execute(sql`delete from events`), mentionsAppendOnly);
    assert.equal((await db.select().from(events)).length, 1, "row left intact");
  } finally {
    await close();
  }
});
