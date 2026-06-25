import test from "node:test";
import assert from "node:assert/strict";
import { slugify } from "./slug";

test("slugify lowercases and dashes non-alphanumerics", () => {
  assert.equal(slugify("Search Page v2!"), "search-page-v2");
  assert.equal(slugify("  Idea — board  "), "idea-board");
  assert.equal(slugify("???"), "prototype"); // fallback for empty
});
