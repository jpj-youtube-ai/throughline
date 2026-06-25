import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// Redact any installation token embedded in a git URL before it reaches a log or
// error message (never expose x-access-token:<token>@).
function redact(s: string): string {
  return s.replace(/x-access-token:[^@]+@/g, "x-access-token:***@");
}

function git(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn("git", args, { stdio: "inherit" });
    p.on("error", reject);
    p.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(redact(`git ${args.join(" ")} exited ${code}`))),
    );
  });
}

export interface EnsureCloneOptions {
  repoFullName: string;
  dir: string;
  token: string; // short-lived installation token
  defaultBranch: string;
}

/**
 * Maintain the local clone of the bound repo (REQ-002). Clone if absent, else
 * fetch + fast-forward the default branch. The installation token authenticates
 * over HTTPS but is never persisted into .git/config — the remote is reset to a
 * tokenless URL afterwards (tokens are short-lived and re-applied each call).
 */
export async function ensureClone(opts: EnsureCloneOptions): Promise<void> {
  const authUrl = `https://x-access-token:${opts.token}@github.com/${opts.repoFullName}.git`;
  const safeUrl = `https://github.com/${opts.repoFullName}.git`;

  if (fs.existsSync(path.join(opts.dir, ".git"))) {
    await git(["-C", opts.dir, "remote", "set-url", "origin", authUrl]);
    await git(["-C", opts.dir, "fetch", "origin", opts.defaultBranch]);
    await git(["-C", opts.dir, "checkout", opts.defaultBranch]);
    await git(["-C", opts.dir, "pull", "--ff-only", "origin", opts.defaultBranch]);
  } else {
    fs.mkdirSync(path.dirname(opts.dir), { recursive: true });
    await git(["clone", "--branch", opts.defaultBranch, authUrl, opts.dir]);
  }

  await git(["-C", opts.dir, "remote", "set-url", "origin", safeUrl]);
}

/**
 * Recent commit subjects of the clone's checked-out branch (REQ-008 generation
 * context) — newest-first, capped at `limit` (default 80). Best-effort: returns
 * [] on any error (non-repo, git failure) so it never blocks generation.
 */
export async function recentGitLog(repoPath: string, opts: { limit?: number } = {}): Promise<string[]> {
  const limit = opts.limit ?? 80;
  return new Promise((resolve) => {
    const p = spawn("git", ["-C", repoPath, "log", "--no-merges", "--format=%s", "-n", String(limit)], {
      stdio: ["ignore", "pipe", "ignore"],
    });
    let out = "";
    p.stdout.on("data", (d) => {
      out += d.toString();
    });
    p.on("error", () => resolve([]));
    p.on("close", (code) => {
      if (code !== 0) return resolve([]);
      resolve(out.split("\n").map((s) => s.trim()).filter(Boolean));
    });
  });
}
