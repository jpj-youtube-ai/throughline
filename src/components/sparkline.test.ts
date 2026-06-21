import test from "node:test";
import assert from "node:assert/strict";
import { sparklinePath } from "./sparkline-math";

test("sparklinePath draws a centered flat line for an empty series", () => {
  const g = sparklinePath([], 100, 20);
  assert.equal(g.path, "M0,10 L100,10");
});

test("sparklinePath maps min to the bottom and max to the top", () => {
  const g = sparklinePath([0, 1, 2], 96, 24);
  // first point: x=0, value=min(0) -> y=height(24); last: x=96, value=max(2) -> y=0
  assert.ok(g.path.startsWith("M0.00,24.00"));
  assert.ok(g.path.endsWith("96.00,0.00"));
});

test("sparklinePath centers a single point", () => {
  const g = sparklinePath([5], 96, 24);
  assert.equal(g.path, "M48.00,24.00");
});
