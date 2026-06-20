import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { users } from "../db/schema";

export interface GithubProfileInput {
  githubId: number;
  githubLogin: string;
  name?: string | null;
  avatarUrl?: string | null;
}

export interface AppUser {
  id: string;
  githubId: number;
  githubLogin: string;
}

/**
 * Provision the app user for a GitHub identity (REQ-001). First sign-in creates
 * the SPEC §3 `users` row; subsequent sign-ins reuse it (idempotent by
 * github_id) and refresh login/name/avatar. Identity only — not part of the
 * project's intent log, so this emits no event.
 */
export async function upsertUserFromGithubProfile(
  db: Db,
  p: GithubProfileInput,
): Promise<AppUser> {
  const [row] = await db
    .insert(users)
    .values({
      githubId: p.githubId,
      githubLogin: p.githubLogin,
      name: p.name ?? null,
      avatarUrl: p.avatarUrl ?? null,
    })
    .onConflictDoUpdate({
      target: users.githubId,
      set: { githubLogin: p.githubLogin, name: p.name ?? null, avatarUrl: p.avatarUrl ?? null },
    })
    .returning({ id: users.id, githubId: users.githubId, githubLogin: users.githubLogin });
  return row;
}

export async function getUserByGithubId(db: Db, githubId: number): Promise<AppUser | null> {
  const rows = await db
    .select({ id: users.id, githubId: users.githubId, githubLogin: users.githubLogin })
    .from(users)
    .where(eq(users.githubId, githubId))
    .limit(1);
  return rows[0] ?? null;
}
