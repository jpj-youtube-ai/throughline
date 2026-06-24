import test from "node:test";
import assert from "node:assert/strict";
import { THROUGHLINE_STYLE } from "./throughline-style";
import { SYSTEM as DIAGRAM_SYSTEM } from "../spec/diagram";
import { SYSTEM as PREVIEW_SYSTEM } from "./generate";

test("brief grounds the aesthetic in the committed @theme tokens", () => {
  for (const token of ["#2E7D6B", "#ECEAE3", "#1A1D2E", "ui-monospace"]) {
    assert.ok(THROUGHLINE_STYLE.includes(token), `brief should mention ${token}`);
  }
});

test("brief bans emoji-as-icons", () => {
  assert.match(THROUGHLINE_STYLE, /no emoji/i);
});

test("both generators compose the shared brief into their SYSTEM prompt", () => {
  assert.ok(DIAGRAM_SYSTEM.includes(THROUGHLINE_STYLE), "requirement diagram SYSTEM must include the shared brief");
  assert.ok(PREVIEW_SYSTEM.includes(THROUGHLINE_STYLE), "issue preview SYSTEM must include the shared brief");
});
