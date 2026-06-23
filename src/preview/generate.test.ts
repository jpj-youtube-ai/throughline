import test from "node:test";
import assert from "node:assert/strict";
import { generatePreviewHtml } from "./generate";

function fakeClient(texts: string[]) {
  let i = 0;
  return { messages: { create: async () => ({ content: [{ type: "text", text: texts[Math.min(i++, texts.length - 1)] }] }) } } as never;
}
const task = { key: "TASK-001", title: "Add a lineup save button", body: "Adds a Save button to the lineup editor." };

test("returns the HTML when the model produces a valid doc", async () => {
  const html = "<!doctype html><html><body><button>Save</button></body></html>";
  const r = await generatePreviewHtml(task, { client: fakeClient([html]), maxRetries: 1 });
  assert.ok(r && r.includes("<button>Save</button>"));
});

test("strips a markdown code fence around the HTML", async () => {
  const r = await generatePreviewHtml(task, { client: fakeClient(["```html\n<html><body>x</body></html>\n```"]), maxRetries: 1 });
  assert.ok(r && r.startsWith("<html>") && !r.includes("```"));
});

test("retries once then returns null on non-HTML output", async () => {
  const r = await generatePreviewHtml(task, { client: fakeClient(["sorry, I can't", "still not html"]), maxRetries: 1 });
  assert.equal(r, null);
});

test("returns null (no throw) on API error", async () => {
  const client = { messages: { create: async () => { throw new Error("boom"); } } } as never;
  const r = await generatePreviewHtml(task, { client, maxRetries: 1 });
  assert.equal(r, null);
});

test("rejects output over the size cap", async () => {
  const big = "<html><body>" + "x".repeat(30000) + "</body></html>";
  const r = await generatePreviewHtml(task, { client: fakeClient([big, big]), maxRetries: 1 });
  assert.equal(r, null);
});
