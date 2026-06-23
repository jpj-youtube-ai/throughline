import test from "node:test";
import assert from "node:assert/strict";
import { formatError } from "./format-error";

test("formatError returns the message for a plain Error", () => {
  assert.equal(formatError(new Error("boom")), "boom");
});

test("formatError stringifies a non-Error value", () => {
  assert.equal(formatError("nope"), "nope");
  assert.equal(formatError(42), "42");
});

test("formatError appends an Error cause's message", () => {
  const e = new Error("wrapper");
  (e as { cause?: unknown }).cause = new Error("the real reason");
  assert.match(formatError(e), /^wrapper \| cause: the real reason$/);
});

test("formatError surfaces Postgres error fields (the drizzle 'Failed query' case)", () => {
  const e = new Error('Failed query: insert into "tasks" ...');
  (e as { cause?: unknown }).cause = {
    message: 'null value in column "project_id" violates not-null constraint',
    code: "23502",
    column: "project_id",
  };
  const out = formatError(e);
  assert.match(out, /Failed query/);
  assert.match(out, /null value in column "project_id"/);
  assert.match(out, /code=23502/);
  assert.match(out, /column=project_id/);
});
