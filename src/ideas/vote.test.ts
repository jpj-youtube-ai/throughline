import test from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { createTestDb, type Db } from "../db/client";
import { users, ideas, votes, events } from "../db/schema";
import { castVote } from "./vote";

async function setup(db: Db): Promise<{ ideaId: string; author: string; u2: string; u3: string }> {
  const mk = async (gid: number, login: string): Promise<string> =>
    (await db.insert(users).values({ githubId: gid, githubLogin: login }).returning({ id: users.id }))[0].id;
  const author = await mk(1, "alice");
  const u2 = await mk(2, "bob");
  const u3 = await mk(3, "carol");
  const [idea] = await db
    .insert(ideas)
    .values({ title: "X", why: "w", authorId: author, state: "voting" })
    .returning({ id: ideas.id });
  return { ideaId: idea.id, author, u2, u3 };
}

const typeCounts = (evs: { type: string }[]) =>
  evs.reduce<Record<string, number>>((acc, e) => ((acc[e.type] = (acc[e.type] ?? 0) + 1), acc), {});

test("a single vote records idea.voted and stays in voting", async () => {
  const { db, close } = await createTestDb();
  try {
    const { ideaId, author } = await setup(db);
    const r = await castVote(db, ideaId, author);
    assert.deepEqual(r, { voted: true, voteCount: 1, approvedNow: false, state: "voting" });
    assert.equal((await db.select().from(ideas).where(eq(ideas.id, ideaId)))[0].state, "voting");
    assert.deepEqual(typeCounts(await db.select().from(events)), { "idea.voted": 1 });
  } finally {
    await close();
  }
});

test("the 2nd distinct approval crosses the gate and approves the idea", async () => {
  const { db, close } = await createTestDb();
  try {
    const { ideaId, author, u2 } = await setup(db);
    await castVote(db, ideaId, author);
    const r = await castVote(db, ideaId, u2);
    assert.equal(r.approvedNow, true);
    assert.equal(r.state, "approved");
    assert.equal(r.voteCount, 2);

    assert.equal((await db.select().from(ideas).where(eq(ideas.id, ideaId)))[0].state, "approved");
    assert.deepEqual(typeCounts(await db.select().from(events)), {
      "idea.voted": 2,
      "idea.gate_passed": 1,
      "idea.approved": 1,
    });
    const approved = (await db.select().from(events).where(eq(events.type, "idea.approved")))[0];
    assert.match(approved.rationale ?? "", /gate/i);
  } finally {
    await close();
  }
});

test("a repeat vote by the same user is an idempotent no-op", async () => {
  const { db, close } = await createTestDb();
  try {
    const { ideaId, author } = await setup(db);
    await castVote(db, ideaId, author);
    const r = await castVote(db, ideaId, author);
    assert.equal(r.voted, false);
    assert.equal(r.voteCount, 1);
    assert.equal((await db.select().from(votes)).length, 1, "no duplicate vote row");
    assert.deepEqual(typeCounts(await db.select().from(events)), { "idea.voted": 1 }, "no second event");
  } finally {
    await close();
  }
});

test("author may vote, and votes after approval have no gate effect (gate fires once)", async () => {
  const { db, close } = await createTestDb();
  try {
    const { ideaId, author, u2, u3 } = await setup(db);
    await castVote(db, ideaId, author); // author votes — allowed
    await castVote(db, ideaId, u2); // crosses the gate → approved
    const r = await castVote(db, ideaId, u3); // post-approval vote
    assert.equal(r.voted, true);
    assert.equal(r.approvedNow, false);
    assert.equal(r.state, "approved");

    assert.equal((await db.select().from(votes)).length, 3);
    const counts = typeCounts(await db.select().from(events));
    assert.equal(counts["idea.voted"], 3);
    assert.equal(counts["idea.gate_passed"], 1, "gate_passed exactly once");
    assert.equal(counts["idea.approved"], 1, "approved exactly once");
  } finally {
    await close();
  }
});
