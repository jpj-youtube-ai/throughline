import test from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { createTestDb } from "./client";
import { project, users, ideas, ideaPhotos } from "./schema";

test("idea_photos stores image bytes + media type, cascades on idea delete", async () => {
  const { db, close } = await createTestDb();
  try {
    const [u] = await db.insert(users).values({ githubId: 1, githubLogin: "u", name: "u" }).returning({ id: users.id });
    const [p] = await db.insert(project).values({ repoFullName: "a/b", installationId: 1, defaultBranch: "main", localClonePath: "/x" }).returning({ id: project.id });
    const [idea] = await db.insert(ideas).values({ title: "t", why: "w", authorId: u.id, state: "voting", projectId: p.id }).returning({ id: ideas.id });
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2]);
    const [row] = await db.insert(ideaPhotos).values({ ideaId: idea.id, image: png, mediaType: "image/png" }).returning({ id: ideaPhotos.id });

    const [got] = await db.select({ image: ideaPhotos.image, mediaType: ideaPhotos.mediaType }).from(ideaPhotos).where(eq(ideaPhotos.id, row.id));
    assert.deepEqual(Buffer.from(got.image as Uint8Array), png);
    assert.equal(got.mediaType, "image/png");

    await db.delete(ideas).where(eq(ideas.id, idea.id));
    assert.equal((await db.select().from(ideaPhotos).where(eq(ideaPhotos.ideaId, idea.id))).length, 0);
  } finally { await close(); }
});
