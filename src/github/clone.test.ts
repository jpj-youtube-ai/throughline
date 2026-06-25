import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { recentGitLog } from "./clone";

function git(dir: string, args: string[]): void {
  execFileSync("git", ["-C", dir, ...args], { stdio: ["ignore", "ignore", "ignore"] });
}

test("recentGitLog returns commit subjects newest-first, respecting limit", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tl-gitlog-"));
  try {
    execFileSync("git", ["init", "-q", dir], { stdio: ["ignore", "ignore", "ignore"] });
    git(dir, ["config", "user.email", "t@e"]);
    git(dir, ["config", "user.name", "t"]);
    for (const s of ["[TASK-001] first", "[TASK-002] second", "[TASK-003] third"]) {
      git(dir, ["commit", "--allow-empty", "-q", "-m", s]);
    }
    assert.deepEqual(await recentGitLog(dir), ["[TASK-003] third", "[TASK-002] second", "[TASK-001] first"]);
    assert.deepEqual(await recentGitLog(dir, { limit: 1 }), ["[TASK-003] third"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("recentGitLog returns [] for a non-git directory (best-effort, no throw)", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tl-nogit-"));
  try {
    assert.deepEqual(await recentGitLog(dir), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
