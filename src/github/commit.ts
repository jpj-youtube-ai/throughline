import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { getInstallationToken } from "./app";

// Redact any installation token embedded in a git URL before it reaches a log or
// error message (never expose x-access-token:<token>@). Mirrors github/clone.ts.
function redact(s: string): string {
  return s.replace(/x-access-token:[^@]+@/g, "x-access-token:***@");
}

function git(args: string[], cwd: string): string {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(redact(`git ${args.join(" ")} failed: ${r.stderr || r.stdout}`));
  return r.stdout.trim();
}

/**
 * Write a file into a repo clone and commit it (only when it changed). Returns
 * the commit sha. Shared by spec materialization (REQ-012) and CLAUDE.md sync
 * (REQ-014).
 */
export function commitFileInClone(
  clonePath: string,
  relPath: string,
  content: string,
  message: string,
): { sha: string } {
  const file = path.join(clonePath, relPath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, "utf8");
  git(["add", "--", relPath], clonePath);
  const changed = git(["status", "--porcelain", "--", relPath], clonePath);
  if (changed) git(["commit", "-m", message, "--", relPath], clonePath);
  return { sha: git(["rev-parse", "HEAD"], clonePath) };
}

export interface PushDeps {
  getToken?: (installationId: number) => Promise<string>;
  run?: (args: string[], cwd: string) => void;
}

/**
 * Push a clone's branch to origin using a fresh App installation token (REQ-014).
 * Run after committing a managed file (e.g. CLAUDE.md) into the clone. The token
 * getter and git runner are injectable for tests.
 */
export async function pushClone(
  clonePath: string,
  repoFullName: string,
  installationId: number,
  branch: string,
  deps: PushDeps = {},
): Promise<void> {
  const getToken = deps.getToken ?? getInstallationToken;
  const run = deps.run ?? ((args, cwd) => { git(args, cwd); });
  const token = await getToken(installationId);
  const url = `https://x-access-token:${token}@github.com/${repoFullName}.git`;
  run(["push", url, `HEAD:${branch}`], clonePath);
}

/**
 * Reconcile a clone's branch with the remote tip before committing/pushing (REQ-014):
 * fetch the branch with a fresh App token and hard-reset the clone to it. This
 * discards any un-pushed local divergence (e.g. accumulated [spec] materialize
 * commits) and any commits the remote gained independently, so the next commit
 * fast-forwards on push instead of being rejected. Token getter + runner injectable.
 */
export async function syncCloneToRemote(
  clonePath: string,
  repoFullName: string,
  installationId: number,
  branch: string,
  deps: PushDeps = {},
): Promise<void> {
  const getToken = deps.getToken ?? getInstallationToken;
  const run = deps.run ?? ((args, cwd) => { git(args, cwd); });
  const token = await getToken(installationId);
  const url = `https://x-access-token:${token}@github.com/${repoFullName}.git`;
  run(["fetch", url, branch], clonePath);
  run(["reset", "--hard", "FETCH_HEAD"], clonePath);
}
