import test from "node:test";
import assert from "node:assert/strict";
import { ideaDecay } from "./decay";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 5, 20);

test("ideaDecay classifies fresh / quiet / stale by idle days", () => {
  assert.deepEqual(ideaDecay(new Date(NOW), NOW), { idleDays: 0, level: "fresh" });
  assert.equal(ideaDecay(new Date(NOW - 1 * DAY), NOW).level, "fresh");
  assert.equal(ideaDecay(new Date(NOW - 2 * DAY), NOW).level, "quiet");
  assert.equal(ideaDecay(new Date(NOW - 9 * DAY), NOW).level, "quiet");

  const stale = ideaDecay(new Date(NOW - 14 * DAY), NOW);
  assert.equal(stale.idleDays, 14);
  assert.equal(stale.level, "stale");

  // future/clock-skew never goes negative
  assert.equal(ideaDecay(new Date(NOW + DAY), NOW).idleDays, 0);
});
