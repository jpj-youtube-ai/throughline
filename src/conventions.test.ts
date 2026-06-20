import test from "node:test";
import assert from "node:assert/strict";
import { BRANCH_PATTERN, PR_TITLE_PATTERN, CONVENTIONS_MARKDOWN } from "./conventions";
import { branchNameFor } from "./tasks/claim";

test("the board's branch names and the [TASK-NNN] title match the documented convention (REQ-011)", () => {
  assert.match(branchNameFor("TASK-014", "Event log table"), BRANCH_PATTERN);
  assert.match("[TASK-014] Event log foundation", PR_TITLE_PATTERN);
  assert.doesNotMatch("Event log foundation", PR_TITLE_PATTERN);
  assert.match(CONVENTIONS_MARKDOWN, /task-<key>-<slug>/);
  assert.match(CONVENTIONS_MARKDOWN, /\[TASK-NNN\]/);
});
