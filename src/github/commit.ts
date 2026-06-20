import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

function git(args: string[], cwd: string): string {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr || r.stdout}`);
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
