import test from "node:test";
import assert from "node:assert/strict";
import { renderHtmlToPng, closeBrowser } from "./render";

test("renders HTML to a non-empty PNG buffer", async () => {
  try {
    const buf = await renderHtmlToPng("<!doctype html><html><body style='margin:0'><h1>Hello</h1></body></html>");
    assert.ok(buf.length > 100, "png should have bytes");
    assert.deepEqual([...buf.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47], "PNG magic bytes");
  } finally { await closeBrowser(); }
});
