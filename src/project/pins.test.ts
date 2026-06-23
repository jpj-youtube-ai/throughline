import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { createTestDb } from "../db/client";
import { project, events } from "../db/schema";
import { normalizePins, setContextPins } from "./pins";

test("normalizePins trims, drops empties, converts separators, dedupes, preserves order", () => {
  const out = normalizePins("  src/db/events.ts \n\n src\\db\\schema.ts \n src/db/events.ts \n");
  assert.deepEqual(out, ["src/db/events.ts", "src/db/schema.ts"]);
});

test("normalizePins accepts an array too", () => {
  assert.deepEqual(normalizePins(["a.ts", "", "a.ts", "b.ts"]), ["a.ts", "b.ts"]);
});

async function seedProject(db: Awaited<ReturnType<typeof createTestDb>>["db"], clonePath: string) {
  const [p] = await db
    .insert(project)
    .values({ repoFullName: "o/r", installationId: 1, defaultBranch: "main", localClonePath: clonePath, specPath: "SPEC.md", claudeMdPath: "CLAUDE.md" })
    .returning({ id: project.id });
  return p.id;
}

test("setContextPins persists normalized pins and emits exactly one event", async () => {
  const { db, close } = await createTestDb();
  try {
    const id = await seedProject(db, "/nonexistent");
    const r = await setContextPins(db, { projectId: id, pins: " src/db/events.ts \n src/db/events.ts ", actorId: null });
    assert.deepEqual(r.pins, ["src/db/events.ts"]);

    const [row] = await db.select({ contextPins: project.contextPins }).from(project).where(eq(project.id, id));
    assert.deepEqual(row.contextPins, ["src/db/events.ts"]);

    const evs = await db.select().from(events).where(eq(events.type, "project.context_pins_changed"));
    assert.equal(evs.length, 1);
    assert.equal((evs[0].payload as { count: number }).count, 1);
    assert.equal(evs[0].subjectId, id);
  } finally {
    await close();
  }
});

test("setContextPins reports how many pins matched the clone", async () => {
  const { db, close } = await createTestDb();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pins-"));
  fs.mkdirSync(path.join(dir, "src", "db"), { recursive: true });
  fs.writeFileSync(path.join(dir, "src/db/events.ts"), "x");
  try {
    const id = await seedProject(db, dir);
    const r = await setContextPins(db, { projectId: id, pins: ["src/db/events.ts", "src/db/missing.ts"], actorId: null });
    assert.equal(r.total, 2);
    assert.equal(r.matched, 1);
  } finally {
    await close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("setContextPins throws on an unknown project", async () => {
  const { db, close } = await createTestDb();
  try {
    await assert.rejects(
      setContextPins(db, { projectId: "00000000-0000-0000-0000-000000000000", pins: [], actorId: null }),
      /not found/i,
    );
  } finally {
    await close();
  }
});
