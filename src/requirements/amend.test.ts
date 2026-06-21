import test from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { createTestDb } from "../db/client";
import { requirements, events } from "../db/schema";
import { amendRequirement } from "./amend";

test("amendRequirement updates the description and records requirement.amended with the why", async () => {
  const { db, close } = await createTestDb();
  try {
    const [r] = await db
      .insert(requirements)
      .values({ key: "REQ-026", title: "Digest to team chat", description: "outbound webhook", provenance: "imported" })
      .returning({ id: requirements.id });

    const res = await amendRequirement(db, {
      key: "REQ-026",
      description: "An on-demand, in-app digest.",
      why: "the outbound config surface never existed; in-app is enough",
    });
    assert.equal(res.id, r.id);

    const [row] = await db.select().from(requirements).where(eq(requirements.id, r.id));
    assert.equal(row.description, "An on-demand, in-app digest.");
    assert.equal(row.title, "Digest to team chat"); // unchanged when title omitted

    const evs = await db.select().from(events).where(eq(events.type, "requirement.amended"));
    assert.equal(evs.length, 1);
    assert.equal(evs[0].subjectId, r.id);
    assert.match(evs[0].rationale ?? "", /never existed/);
  } finally {
    await close();
  }
});

test("amendRequirement throws on an unknown key", async () => {
  const { db, close } = await createTestDb();
  try {
    await assert.rejects(amendRequirement(db, { key: "REQ-999", description: "x", why: "y" }), /no such requirement/);
  } finally {
    await close();
  }
});
