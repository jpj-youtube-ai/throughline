import test from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { createTestDb } from "./client";
import { project, prototypes } from "./schema";

test("prototypes row round-trips html + nullable image, scoped to a project", async () => {
  const { db, close } = await createTestDb();
  try {
    const [p] = await db.insert(project).values({ repoFullName: "a/b", installationId: 1, defaultBranch: "main", localClonePath: "/x" }).returning({ id: project.id });
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    const [row] = await db.insert(prototypes).values({ projectId: p.id, label: "Search page", html: "<html><body>hi</body></html>" }).returning({ id: prototypes.id });

    const [fresh] = await db.select({ label: prototypes.label, html: prototypes.html, image: prototypes.image }).from(prototypes).where(eq(prototypes.id, row.id));
    assert.equal(fresh.label, "Search page");
    assert.match(fresh.html, /hi/);
    assert.equal(fresh.image, null, "image defaults null until rendered");

    await db.update(prototypes).set({ image: png }).where(eq(prototypes.id, row.id));
    const [withImg] = await db.select({ image: prototypes.image }).from(prototypes).where(eq(prototypes.id, row.id));
    assert.deepEqual(Buffer.from(withImg.image as Uint8Array), png);
  } finally { await close(); }
});
