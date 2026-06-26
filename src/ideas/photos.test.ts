import test from "node:test";
import assert from "node:assert/strict";
import { createTestDb, type Db } from "../db/client";
import { project, users, ideas, ideaPhotos } from "../db/schema";
import { loadIdeaPhotos, getIdeaPhoto } from "./photos";

let _userCounter = 1;

async function seedIdea(db: Db): Promise<string> {
  const githubId = _userCounter++;
  const [u] = await db.insert(users).values({ githubId, githubLogin: `u${githubId}` }).returning({ id: users.id });
  const [p] = await db.insert(project).values({ repoFullName: `a/b${githubId}`, installationId: githubId, defaultBranch: "main", localClonePath: "/x" }).returning({ id: project.id });
  const [i] = await db.insert(ideas).values({ title: "t", why: "w", authorId: u.id, state: "voting", projectId: p.id }).returning({ id: ideas.id });
  return i.id;
}

test("loadIdeaPhotos returns the idea's photo ids, scoped", async () => {
  const { db, close } = await createTestDb();
  try {
    const a = await seedIdea(db);
    const b = await seedIdea(db);
    await db.insert(ideaPhotos).values({ ideaId: a, image: Buffer.from([1]), mediaType: "image/png" });
    await db.insert(ideaPhotos).values({ ideaId: b, image: Buffer.from([2]), mediaType: "image/png" });
    const got = await loadIdeaPhotos(db, a);
    assert.equal(got.length, 1);
    assert.ok(typeof got[0].id === "string");
  } finally { await close(); }
});

test("getIdeaPhoto returns bytes + media type, null for a bad/absent id", async () => {
  const { db, close } = await createTestDb();
  try {
    const a = await seedIdea(db);
    const jpg = Buffer.from([9, 9]);
    const [row] = await db.insert(ideaPhotos).values({ ideaId: a, image: jpg, mediaType: "image/jpeg" }).returning({ id: ideaPhotos.id });
    const got = await getIdeaPhoto(db, row.id);
    assert.deepEqual(got?.image, jpg);
    assert.equal(got?.mediaType, "image/jpeg");
    assert.equal(await getIdeaPhoto(db, "not-a-uuid"), null);
  } finally { await close(); }
});
