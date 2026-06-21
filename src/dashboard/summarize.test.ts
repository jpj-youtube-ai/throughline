import test from "node:test";
import assert from "node:assert/strict";
import type { TaskListItem } from "../tasks/queries";
import type { ActivityItem } from "../events/feed";
import type { SpecMapRequirement } from "../spec/map";
import { eventsSince, taskBreakdown, topTasks, reqBreakdown, pct } from "./summarize";

function task(p: Partial<TaskListItem> & { key: string }): TaskListItem {
  const { key, ...rest } = p;
  return {
    id: key, key, title: key, requirementKey: "REQ-001", effort: 1, risk: "low",
    confidence: 50, claimState: "unclaimed", claimerLogin: null, branchName: null,
    githubStatus: "open", githubIssueUrl: null, ...rest,
  };
}

test("eventsSince counts items at or after the cutoff", () => {
  const items = [
    { createdAt: new Date(5000) },
    { createdAt: new Date(1000) },
  ] as ActivityItem[];
  assert.equal(eventsSince(items, 2000), 1);
});

test("taskBreakdown splits open / claimed / merged", () => {
  const b = taskBreakdown([
    task({ key: "TASK-001" }),
    task({ key: "TASK-002", claimState: "claimed", claimerLogin: "alice" }),
    task({ key: "TASK-003", githubStatus: "closed", claimState: "claimed" }),
  ]);
  assert.deepEqual(b, { open: 1, claimed: 1, merged: 1 });
});

test("topTasks ranks claimed-open first, then open, then merged, newest key within a rank", () => {
  const top = topTasks([
    task({ key: "TASK-001" }),
    task({ key: "TASK-002", githubStatus: "closed" }),
    task({ key: "TASK-003", claimState: "claimed", claimerLogin: "alice" }),
    task({ key: "TASK-004" }),
  ], 2);
  assert.deepEqual(top.map((t) => t.key), ["TASK-003", "TASK-004"]);
});

test("reqBreakdown counts by status", () => {
  const reqs = [
    { status: "shipped" }, { status: "building" }, { status: "planned" }, { status: "planned" },
  ] as SpecMapRequirement[];
  assert.deepEqual(reqBreakdown(reqs), { planned: 2, building: 1, shipped: 1 });
});

test("pct rounds and guards divide-by-zero", () => {
  assert.equal(pct(0, 0), 0);
  assert.equal(pct(17, 27), 63);
});
