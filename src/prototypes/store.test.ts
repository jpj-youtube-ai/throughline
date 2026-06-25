import test from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { createTestDb, type Db } from "../db/client";
import { project, prototypes, events } from "../db/schema";
import { addPrototype, removePrototype, loadProjectPrototypes } from "./store";

async function seedProject(db: Db, repo: string, inst: number): Promise<string> {
  const [p] = await db.insert(project).values({ repoFullName: repo, installationId: inst, defaultBranch: "main", localClonePath: "/x" }).returning({ id: project.id });
  return p.id;
}

test("addPrototype inserts and emits prototype.added in one tx", async () => {
  const { db, close } = await createTestDb();
  try {
    const pid = await seedProject(db, "a/b", 1);
    const { id } = await addPrototype(db, { projectId: pid, label: "Home", html: "<h1>Home</h1>" });
    const [row] = await db.select().from(prototypes).where(eq(prototypes.id, id));
    assert.equal(row.label, "Home");
    const evs = await db.select().from(events).where(eq(events.type, "prototype.added"));
    assert.equal(evs.length, 1);
    assert.equal(evs[0].projectId, pid);
  } finally { await close(); }
});

test("removePrototype deletes and emits prototype.removed in one tx", async () => {
  const { db, close } = await createTestDb();
  try {
    const pid = await seedProject(db, "a/b", 1);
    const { id } = await addPrototype(db, { projectId: pid, label: "Home", html: "<h1>Home</h1>" });
    const r = await removePrototype(db, { id });
    assert.equal(r.removed, true);
    assert.equal((await db.select().from(prototypes).where(eq(prototypes.id, id))).length, 0);
    assert.equal((await db.select().from(events).where(eq(events.type, "prototype.removed"))).length, 1);
    // removing a non-existent id is a clean no-op
    assert.deepEqual(await removePrototype(db, { id: "00000000-0000-0000-0000-000000000000" }), { removed: false });
  } finally { await close(); }
});

test("loadProjectPrototypes returns id+label rows for the project, newest-first, no image, no cap", async () => {
  const { db, close } = await createTestDb();
  try {
    const a = await seedProject(db, "a/alpha", 1);
    const b = await seedProject(db, "a/beta", 2);
    // a: three rows — all should be returned
    await db.insert(prototypes).values({ projectId: a, label: "A-old", html: "x", createdAt: new Date("2026-01-01T00:00:00Z") });
    await db.insert(prototypes).values({ projectId: a, label: "A-new", html: "x", createdAt: new Date("2026-01-02T00:00:00Z") });
    await db.insert(prototypes).values({ projectId: a, label: "A-third", html: "x", createdAt: new Date("2026-01-03T00:00:00Z") });
    await db.insert(prototypes).values({ projectId: b, label: "B", html: "x" });

    const got = await loadProjectPrototypes(db, a);
    assert.deepEqual(got.map((g) => g.label), ["A-third", "A-new", "A-old"], "all three, newest-first, no B leakage");
    assert.ok(got.every((g) => "id" in g && "label" in g && !("image" in g)), "only id+label fields");
  } finally { await close(); }
});
