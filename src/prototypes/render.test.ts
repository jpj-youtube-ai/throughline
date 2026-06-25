import test from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { createTestDb, type Db } from "../db/client";
import { project, prototypes } from "../db/schema";
import { renderPrototypeImages } from "./render";

async function seed(db: Db, repo: string, inst: number): Promise<string> {
  const [p] = await db.insert(project).values({ repoFullName: repo, installationId: inst, defaultBranch: "main", localClonePath: "/x" }).returning({ id: project.id });
  return p.id;
}

test("renderPrototypeImages renders only un-rendered prototypes, stores the PNG, project-scoped", async () => {
  const { db, close } = await createTestDb();
  try {
    const a = await seed(db, "a/alpha", 1);
    const b = await seed(db, "a/beta", 2);
    const [unrendered] = await db.insert(prototypes).values({ projectId: a, label: "A1", html: "<h1>a</h1>" }).returning({ id: prototypes.id });
    await db.insert(prototypes).values({ projectId: a, label: "A2", html: "x", image: Buffer.from([1]) }); // already rendered → skip
    await db.insert(prototypes).values({ projectId: b, label: "B1", html: "<h1>b</h1>" }); // other project → skip

    const calls: string[] = [];
    const fakeRender = async (html: string) => { calls.push(html); return Buffer.from([7, 7, 7]); };

    const r = await renderPrototypeImages(db, a, fakeRender);
    assert.deepEqual(r.rendered, [unrendered.id]);
    assert.deepEqual(calls, ["<h1>a</h1>"], "only the un-rendered A prototype rendered");
    const [row] = await db.select({ image: prototypes.image }).from(prototypes).where(eq(prototypes.id, unrendered.id));
    assert.deepEqual(Buffer.from(row.image as Uint8Array), Buffer.from([7, 7, 7]));
  } finally { await close(); }
});

test("renderPrototypeImages: a render failure is isolated and leaves image null (retryable)", async () => {
  const { db, close } = await createTestDb();
  try {
    const a = await seed(db, "a/alpha", 1);
    const [p1] = await db.insert(prototypes).values({ projectId: a, label: "boom", html: "1" }).returning({ id: prototypes.id });
    const [p2] = await db.insert(prototypes).values({ projectId: a, label: "ok", html: "2" }).returning({ id: prototypes.id });
    const render = async (html: string) => { if (html === "1") throw new Error("chromium boom"); return Buffer.from([2]); };
    const r = await renderPrototypeImages(db, a, render);
    assert.deepEqual(r.rendered, [p2.id]);
    assert.equal((await db.select({ i: prototypes.image }).from(prototypes).where(eq(prototypes.id, p1.id)))[0].i, null);
  } finally { await close(); }
});
