import test from "node:test";
import assert from "node:assert/strict";
import { buildUserContent } from "./run";

test("buildUserContent returns the bare text when no images", () => {
  assert.deepEqual(buildUserContent("hello", []), [{ type: "text", text: "hello" }]);
});

test("buildUserContent appends base64 image blocks after the text", () => {
  const c = buildUserContent("prompt", [{ mediaType: "image/png", data: "AAAA" }]);
  assert.equal(c.length, 2);
  assert.deepEqual(c[0], { type: "text", text: "prompt" });
  assert.deepEqual(c[1], { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } });
});
