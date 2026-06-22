import test from "node:test";
import assert from "node:assert/strict";
import { createTestDb } from "../db/client";
import { project, users } from "../db/schema";
import { getActiveProjectId } from "./active";

test("getActiveProjectId throws when no project is bound", async () => {
  const { db, close } = await createTestDb();
  try {
    await assert.rejects(() => getActiveProjectId(db), /no project/i);
  } finally {
    await close();
  }
});

test("getActiveProjectId falls back to the oldest project when user has none set", async () => {
  const { db, close } = await createTestDb();
  try {
    const [p] = await db
      .insert(project)
      .values({
        repoFullName: "o/orbit",
        installationId: 1,
        defaultBranch: "main",
        localClonePath: "/tmp",
        specPath: "SPEC.md",
        claudeMdPath: "CLAUDE.md",
      })
      .returning({ id: project.id });
    assert.equal(await getActiveProjectId(db), p.id);
    const [u] = await db
      .insert(users)
      .values({ githubId: 1, githubLogin: "alice" })
      .returning({ id: users.id });
    assert.equal(await getActiveProjectId(db, u.id), p.id); // user has no active set -> oldest
  } finally {
    await close();
  }
});

test("getActiveProjectId returns the user's active project when set", async () => {
  const { db, close } = await createTestDb();
  try {
    const [p1] = await db
      .insert(project)
      .values({
        repoFullName: "o/a",
        installationId: 1,
        defaultBranch: "main",
        localClonePath: "/a",
        specPath: "SPEC.md",
        claudeMdPath: "CLAUDE.md",
      })
      .returning({ id: project.id });
    const [p2] = await db
      .insert(project)
      .values({
        repoFullName: "o/b",
        installationId: 2,
        defaultBranch: "main",
        localClonePath: "/b",
        specPath: "SPEC.md",
        claudeMdPath: "CLAUDE.md",
      })
      .returning({ id: project.id });
    const [u] = await db
      .insert(users)
      .values({ githubId: 2, githubLogin: "bob", activeProjectId: p2.id })
      .returning({ id: users.id });
    assert.equal(await getActiveProjectId(db, u.id), p2.id);
    assert.notEqual(p1.id, p2.id);
  } finally {
    await close();
  }
});
