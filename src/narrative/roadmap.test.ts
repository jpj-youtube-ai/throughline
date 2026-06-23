import test from "node:test";
import assert from "node:assert/strict";
import { generateRoadmapHtml } from "./roadmap";

function fakeClient(texts: string[]) {
  let i = 0;
  return { messages: { create: async () => ({ content: [{ type: "text", text: texts[Math.min(i++, texts.length - 1)] }] }) } } as never;
}
const input = {
  chapters: [{ heading: "Foundations", prose: "The team built the event log." }],
  requirements: [
    { key: "REQ-001", title: "Event log", status: "shipped" as const },
    { key: "REQ-016", title: "Narrative", status: "building" as const },
    { key: "REQ-020", title: "Pipeline view", status: "planned" as const },
  ],
};

test("returns roadmap HTML for valid output", async () => {
  const html = "<!doctype html><html><body><div>roadmap</div></body></html>";
  const r = await generateRoadmapHtml(input, { client: fakeClient([html]), maxRetries: 1 });
  assert.ok(r && r.includes("roadmap"));
});

test("strips a code fence", async () => {
  const r = await generateRoadmapHtml(input, { client: fakeClient(["```html\n<html><body>x</body></html>\n```"]), maxRetries: 1 });
  assert.ok(r && r.startsWith("<html>") && !r.includes("```"));
});

test("retries once then null on non-HTML", async () => {
  const r = await generateRoadmapHtml(input, { client: fakeClient(["nope", "still nope"]), maxRetries: 1 });
  assert.equal(r, null);
});

test("null (no throw) on API error", async () => {
  const client = { messages: { create: async () => { throw new Error("boom"); } } } as never;
  assert.equal(await generateRoadmapHtml(input, { client, maxRetries: 1 }), null);
});

test("rejects output over the size cap", async () => {
  const big = "<html><body>" + "x".repeat(40000) + "</body></html>";
  assert.equal(await generateRoadmapHtml(input, { client: fakeClient([big, big]), maxRetries: 1 }), null);
});
