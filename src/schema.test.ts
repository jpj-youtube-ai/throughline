import test from "node:test";
import assert from "node:assert/strict";
import { GenerationOutputSchema, semanticErrors } from "./schema";

const base = { new_requirements: [], tasks: [{ title: "UI", requirement_key: "REQ-001", body: { pointers: ["x"], acceptance_check: "y" }, effort: 1, risk: "low", confidence: 50, prototypes: [] as string[] }] };
const ctx = { existingKeys: new Set(["REQ-001"]), nextNumber: 2, prototypeLabels: new Set(["Search page"]) };

test("a task may carry valid prototype labels", () => {
  const out = GenerationOutputSchema.parse({ ...base, tasks: [{ ...base.tasks[0], prototypes: ["Search page"] }] });
  assert.deepEqual(semanticErrors(out, ctx), []);
});

test("an unknown prototype label is a semantic error", () => {
  const out = GenerationOutputSchema.parse({ ...base, tasks: [{ ...base.tasks[0], prototypes: ["Nope"] }] });
  assert.ok(semanticErrors(out, ctx).some((e) => /prototype/i.test(e) && /Nope/.test(e)));
});

test("empty prototypes is always valid", () => {
  const out = GenerationOutputSchema.parse(base);
  assert.deepEqual(semanticErrors(out, ctx), []);
});
