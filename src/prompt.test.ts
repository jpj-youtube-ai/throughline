import test from "node:test";
import assert from "node:assert/strict";
import { buildUserMessage, SYSTEM_PROMPT, type UserMessageParts } from "./prompt";
import type { RepoSlice } from "./repoSlice";

const slice: RepoSlice = { repoLabel: "acme/repo", nearEmpty: false, fileCount: 0, tree: "(empty)", treeTruncated: false, files: [], omitted: [] };
const base: UserMessageParts = {
  conventions: null,
  existingList: "",
  nextKey: "REQ-001",
  specText: "spec",
  idea: { title: "Idea", why: "why", feasibility: null, viability: null },
  slice,
};

test("buildUserMessage renders the ALREADY IN THIS PROJECT section with tasks + commits", () => {
  const msg = buildUserMessage({
    ...base,
    taskSummary: ["TASK-001 [closed] — Event log → REQ-014"],
    recentCommits: ["[TASK-001] event-log-table"],
  });
  assert.ok(msg.includes("## ALREADY IN THIS PROJECT"));
  assert.ok(msg.includes("TASK-001 [closed] — Event log → REQ-014"));
  assert.ok(msg.includes("[TASK-001] event-log-table"));
});

test("buildUserMessage shows a greenfield note when there is nothing built", () => {
  const msg = buildUserMessage({ ...base, taskSummary: [], recentCommits: [] });
  assert.ok(msg.includes("## ALREADY IN THIS PROJECT"));
  assert.ok(/nothing built yet/i.test(msg));
});

test("SYSTEM_PROMPT carries the no-duplication rule", () => {
  assert.ok(/do not duplicate completed or in-flight work/i.test(SYSTEM_PROMPT));
});

test("SYSTEM_PROMPT instructs marking frontend tasks with prototype labels", () => {
  assert.ok(/prototypes/i.test(SYSTEM_PROMPT) && /label/i.test(SYSTEM_PROMPT));
});

