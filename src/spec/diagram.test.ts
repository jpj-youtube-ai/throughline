import test from "node:test";
import assert from "node:assert/strict";
import { generateRequirementDiagramHtml } from "./diagram";

function fakeClient(texts: string[]) {
  let i = 0;
  return { messages: { create: async () => ({ content: [{ type: "text", text: texts[Math.min(i++, texts.length - 1)] }] }) } } as never;
}
const input = {
  key: "REQ-017",
  title: "Spec map",
  description: "A grid of requirement cells — not-started / building / shipped.",
  tasks: [{ key: "TASK-059", title: "Requirement diagram", status: "open" as const }],
};

test("returns diagram HTML for valid output", async () => {
  const html = "<!doctype html><html><body><div>concept</div></body></html>";
  const r = await generateRequirementDiagramHtml(input, { client: fakeClient([html]), maxRetries: 1 });
  assert.ok(r && r.includes("concept"));
});

test("strips a code fence", async () => {
  const r = await generateRequirementDiagramHtml(input, { client: fakeClient(["```html\n<html><body>x</body></html>\n```"]), maxRetries: 1 });
  assert.ok(r && r.startsWith("<html>") && !r.includes("```"));
});

test("retries once then null on non-HTML", async () => {
  const r = await generateRequirementDiagramHtml(input, { client: fakeClient(["nope", "still nope"]), maxRetries: 1 });
  assert.equal(r, null);
});

test("null (no throw) on API error", async () => {
  const client = { messages: { create: async () => { throw new Error("boom"); } } } as never;
  assert.equal(await generateRequirementDiagramHtml(input, { client, maxRetries: 1 }), null);
});

test("rejects output over the size cap", async () => {
  const big = "<html><body>" + "x".repeat(40000) + "</body></html>";
  assert.equal(await generateRequirementDiagramHtml(input, { client: fakeClient([big, big]), maxRetries: 1 }), null);
});
