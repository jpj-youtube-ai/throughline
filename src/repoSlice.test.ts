import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildSlice, matchPins } from "./repoSlice";

function tmpRepo(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "slice-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return dir;
}

test("buildSlice force-includes a pinned file under a tight budget, omitting a higher-scoring file", () => {
  const dir = tmpRepo({
    "src/relevant.ts": "leaderboard ".repeat(500), // high keyword score, large
    "src/db/events.ts": "// pinned marker\n", // zero keyword score, tiny
  });
  try {
    const slice = buildSlice({
      repoPath: dir,
      excludeAbs: [],
      ideaTitle: "leaderboard",
      ideaWhy: "leaderboard widget",
      includes: ["src/db/events.ts"],
      relevantPaths: [],
      budgetTokens: 100, // fits the tiny pinned file only
    });
    const paths = slice.files.map((f) => f.relPath);
    assert.ok(paths.includes("src/db/events.ts"), "pinned file is force-included");
    assert.ok(!paths.includes("src/relevant.ts"), "higher-scoring file is omitted under budget");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("matchPins returns the pins matching at least one eligible file", () => {
  const dir = tmpRepo({ "src/db/events.ts": "x", "src/app/page.tsx": "y" });
  try {
    const matched = matchPins(dir, ["src/db/events.ts", "src/missing.ts", "src/app/**"]);
    assert.deepEqual(matched.sort(), ["src/app/**", "src/db/events.ts"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
