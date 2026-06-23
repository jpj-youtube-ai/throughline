import type Anthropic from "@anthropic-ai/sdk";
import { createClient } from "../anthropic";
import { extractText, extractHtml, isValidHtml } from "./html";

const MODEL_ID = "claude-sonnet-4-6";
const MAX_HTML_BYTES = 20000;

const SYSTEM = `You produce ONE small, self-contained HTML "explainer" graphic that lets a
NON-TECHNICAL person instantly understand what a change does — like explaining it to a
friend who can't code. Rules:
- Output ONLY one HTML document. No prose, no markdown, no code fences.
- Inline <style> only. No external resources, no <script>, no network.
- Be VISUAL-FIRST with very little text: big simple shapes, arrows, and icons (inline SVG
  or emoji are fine), plus at most a few short plain-language labels.
- NO code, file names, technical terms, data structures, or app-UI mockups.
- Show the OUTCOME / benefit — ideally a real-world ANALOGY, or a simple before -> after.
- One clear idea. Friendly, calm colors, lots of whitespace, ~900px wide, well under 20KB.`;

function buildUserMessage(task: { key: string; title: string; body: string }): string {
  return `Here is a software change. Draw a simple visual explainer for a NON-TECHNICAL person: what does this actually DO for them, shown as a picture, diagram, or real-world analogy — not the technical details.

Title: ${task.title}

Background (for your understanding only — do NOT copy this text into the image):
${task.body}

Return the HTML explainer now.`;
}


export async function generatePreviewHtml(
  task: { key: string; title: string; body: string },
  deps: { client?: Anthropic; modelId?: string; maxRetries?: number } = {},
): Promise<string | null> {
  const client = deps.client ?? createClient();
  const modelId = deps.modelId ?? MODEL_ID;
  const maxRetries = deps.maxRetries ?? 1;
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: buildUserMessage(task) }];

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let message: Anthropic.Message;
    try {
      message = await client.messages.create({ model: modelId, max_tokens: 4000, system: SYSTEM, messages });
    } catch {
      return null; // API/transport error — skip the visual entirely
    }
    const html = extractHtml(extractText(message));
    if (html && isValidHtml(html) && Buffer.byteLength(html, "utf8") <= MAX_HTML_BYTES) return html;
    messages.push({ role: "assistant", content: message.content });
    messages.push({ role: "user", content: "That was not usable. Return ONLY one self-contained HTML document under 20KB — no prose, no code fences." });
  }
  return null;
}
