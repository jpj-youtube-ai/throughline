import type Anthropic from "@anthropic-ai/sdk";
import { createClient } from "../anthropic";
import { extractText, extractHtml, isValidHtml } from "../preview/html";
import { THROUGHLINE_STYLE } from "../preview/throughline-style";

const MODEL_ID = "claude-sonnet-4-6";
const MAX_HTML_BYTES = 30000;

export interface RequirementDiagramInput {
  key: string;
  title: string;
  description: string;
  tasks: { key: string; title: string; status: "open" | "closed" }[];
}

const ROLE = `You produce ONE self-contained HTML "concept diagram" that explains, for a NON-TECHNICAL reader, what a single software requirement represents — what the capability does and why it matters. Be VISUAL-FIRST and low-text: simple shapes, boxes/arrows, and inline-SVG line icons, with at most one short real-world analogy — prefer a diagram over paragraphs. Communicate the IDEA of the requirement, not its implementation: no code, no file names, no jargon.`;

const OUTPUT_CONTRACT = `OUTPUT: return ONLY one HTML document — no prose, no markdown, no code fences. Ground EVERYTHING strictly in the requirement title, description, and task list provided; do NOT invent features, mechanisms, scope, dates, or numbers not present. Keep it well under 30KB.`;

export const SYSTEM = `${ROLE}\n\n${THROUGHLINE_STYLE}\n\n${OUTPUT_CONTRACT}`;

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
