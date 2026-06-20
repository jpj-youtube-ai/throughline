import test from "node:test";
import assert from "node:assert/strict";
import GitHub from "next-auth/providers/github";
import { createTestDb } from "../db/client";
import { users } from "../db/schema";
import { upsertUserFromGithubProfile } from "./users";
import { providers } from "./providers";

test("first sign-in creates a user; subsequent sign-ins reuse the same row", async () => {
  const { db, close } = await createTestDb();
  try {
    const a = await upsertUserFromGithubProfile(db, {
      githubId: 42,
      githubLogin: "alice",
      name: "Alice",
      avatarUrl: "https://x/a.png",
    });
    assert.ok(a.id);
    assert.equal((await db.select().from(users)).length, 1);

    // Same GitHub id signs in again with a changed login: reuse the row, refresh fields.
    const b = await upsertUserFromGithubProfile(db, {
      githubId: 42,
      githubLogin: "alice-renamed",
      name: "Alice A.",
      avatarUrl: "https://x/b.png",
    });
    assert.equal(b.id, a.id, "same row reused");
    const all = await db.select().from(users);
    assert.equal(all.length, 1, "no duplicate row");
    assert.equal(all[0].githubLogin, "alice-renamed", "profile refreshed on re-login");

    // A different GitHub id is a different user.
    const c = await upsertUserFromGithubProfile(db, { githubId: 99, githubLogin: "bob" });
    assert.notEqual(c.id, a.id);
    assert.equal((await db.select().from(users)).length, 2);
  } finally {
    await close();
  }
});

test("GitHub is the sole configured sign-in provider (REQ-001)", () => {
  assert.equal(providers.length, 1);
  assert.equal(providers[0], GitHub);
});
