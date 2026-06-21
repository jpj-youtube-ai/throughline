// src/requirements/declare.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { createTestDb } from "../db/client";
import { requirements, events } from "../db/schema";
import { eq } from "drizzle-orm";
import { declareRequirement } from "./declare";

test("declareRequirement mints REQ-001 on an empty table and emits requirement.declared", async () => {
  const { db, close } = await createTestDb();
  try {
    const r = await declareRequirement(db, { title: "Overview dashboard", description: "d", provenance: "drift", why: "because" });
    assert.equal(r.key, "REQ-001");

    const [row] = await db.select().from(requirements).where(eq(requirements.id, r.id));
    assert.equal(row.key, "REQ-001");
    assert.equal(row.provenance, "drift");
    assert.equal(row.status, "planned");

    const evs = await db.select().from(events).where(eq(events.subjectId, r.id));
    assert.equal(evs.length, 1);
    assert.equal(evs[0].type, "requirement.declared");
    assert.equal(evs[0].rationale, "because");
  } finally {
    await close();
  }
});

test("declareRequirement uses max existing number + 1, not the count", async () => {
  const { db, close } = await createTestDb();
  try {
    await db.insert(requirements).values([
      { key: "REQ-001", title: "a", description: "", provenance: "imported" },
      { key: "REQ-005", title: "b", description: "", provenance: "imported" }, // gap
    ]);
    const r = await declareRequirement(db, { title: "next", provenance: "drift" });
    assert.equal(r.key, "REQ-006");
  } finally {
    await close();
  }
});
