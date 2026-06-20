import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { Db } from "../db/client";
import { project } from "../db/schema";

function git(args: string[], cwd: string): string {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr || r.stdout}`);
  return r.stdout.trim();
}

/**
 * Write the materialized spec into the bound repo's local clone and commit it,
 * returning the commit sha (REQ-012). Commits to the clone; pushing / opening a
 * PR is left to the App flow. Only commits when the content actually changed.
 */
export async function repoCommit(db: Db, content: string): Promise<{ sha: string }> {
  const [proj] = await db.select().from(project).limit(1);
  if (!proj) throw new Error("No project bound (REQ-002).");

  const specFile = path.join(proj.localClonePath, proj.specPath);
  fs.mkdirSync(path.dirname(specFile), { recursive: true });
  fs.writeFileSync(specFile, content, "utf8");

  git(["add", "--", proj.specPath], proj.localClonePath);
  const changed = git(["status", "--porcelain", "--", proj.specPath], proj.localClonePath);
  if (changed) {
    git(["commit", "-m", "[spec] materialize requirements", "--", proj.specPath], proj.localClonePath);
  }
  return { sha: git(["rev-parse", "HEAD"], proj.localClonePath) };
}
