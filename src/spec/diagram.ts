import type Anthropic from "@anthropic-ai/sdk";
import { createClient } from "../anthropic";
import { extractText, extractHtml, isValidHtml } from "../preview/html";

const MODEL_ID = "claude-sonnet-4-6";
const MAX_HTML_BYTES = 30000;

export interface RequirementDiagramInput {
  key: string;
  title: string;
  description: string;
  tasks: { key: string; title: string; status: "open" | "closed" }[];
}

const SYSTEM = `You produce ONE self-contained HTML "concept diagram" that explains, for a NON-TECHNICAL reader, what a single software requirement represents — what the capability does and why it matters.
Rules:
- Output ONLY one HTML document. No prose, no markdown, no code fences.
- Inline <style> only. No external resources, no <script>, no network.
- VISUAL-FIRST and low-text: use simple shapes, boxes/arrows, icons or emoji, and at most one short real-world analogy. Prefer a diagram over paragraphs.
- Communicate the IDEA of the requirement, not its implementation. No code, no file names, no jargon.
- Aesthetic (ledger): light "paper" background (~#FAF8F3), dark ink text (~#1A1A1A), hairline borders (~#E5E0D8), a verdigris/teal accent (~#2E7D74). Clean modern sans for headings, a monospace for the REQ id only. Calm, lots of whitespace. Body width ~100% (max ~900px), centered. Well under 30KB.
- Ground EVERYTHING strictly in the requirement title, description, and task list provided. Do NOT invent features, mechanisms, scope, dates, or numbers not present.`;

function buildUserMessage(input: RequirementDiagramInput): string {
  const tasks = input.tasks.length
    ? input.tasks.map((t) => `- ${t.key} (${t.status === "closed" ? "done" : "in progress/planned"}): ${t.title}`).join("\n")
    : "(no tasks yet)";
  return `## Requirement ${input.key}: ${input.title}\n\n## What it means (description)\n${input.description || "(no description)"}\n\n## The work under it (tasks)\n${tasks}\n\nDraw the concept diagram now, grounded strictly in the above.`;
}

export async function generateRequirementDiagramHtml(
  input: RequirementDiagramInput,
  deps: { client?: Anthropic; modelId?: string; maxRetries?: number } = {},
): Promise<string | null> {
  const client = deps.client ?? createClient();
  const modelId = deps.modelId ?? MODEL_ID;
  const maxRetries = deps.maxRetries ?? 1;
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: buildUserMessage(input) }];

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let message: Anthropic.Message;
    try {
      message = await client.messages.create({ model: modelId, max_tokens: 6000, system: SYSTEM, messages });
    } catch {
      return null;
    }
    const html = extractHtml(extractText(message));
    if (html && isValidHtml(html) && Buffer.byteLength(html, "utf8") <= MAX_HTML_BYTES) return html;
    messages.push({ role: "assistant", content: message.content });
    messages.push({ role: "user", content: "That was not usable. Return ONLY one self-contained HTML document under 30KB — no prose, no code fences." });
  }
  return null;
}
