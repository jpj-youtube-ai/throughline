import test from "node:test";
import assert from "node:assert/strict";
import { createTestDb } from "../db/client";
import { requirements, tasks } from "../db/schema";
import { reconcileSpec, reconcileStructural } from "./reconcile";

test("reconcileSpec flags a mismatch (ignoring trailing whitespace)", () => {
  assert.equal(reconcileSpec("same", "same").stale, false);
  assert.equal(reconcileSpec("a", "b").stale, true);
  assert.equal(reconcileSpec("x\n\n", "x").stale, false);
});

test("reconcileStructural reports stale when SPEC.md differs from the requirements", async () => {
  const { db, close } = await createTestDb();
  try {
    const [r3] = await db
      .insert(requirements)
      .values({ key: "REQ-003", title: "Event log", description: "d", provenance: "imported", status: "shipped" })
      .returning({ id: requirements.id });
    await db
      .insert(requirements)
      .values({ key: "REQ-005", title: "Submit idea", description: "d", provenance: "voted", status: "planned" });
    await db
      .insert(tasks)
      .values({ key: "TASK-001", title: "Build the log", body: "b", requirementId: r3.id, effort: 1, risk: "low", confidence: 50 });

    // An obviously-out-of-date file is stale.
    const stale = await reconcileStructural(db, "# old hand-written spec\n");
    assert.equal(stale.specStale, true);
    assert.equal(stale.requirementCount, 2);
    assert.match(stale.rendered, /REQ-003 — Event log/);

    // Feeding back exactly what the requirements render to is up to date.
    const current = await reconcileStructural(db, stale.rendered);
    assert.equal(current.specStale, false);
  } finally {
    await close();
  }
});
