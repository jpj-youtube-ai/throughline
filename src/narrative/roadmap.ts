import type Anthropic from "@anthropic-ai/sdk";
import { createClient } from "../anthropic";
import { extractText, extractHtml, isValidHtml } from "../preview/html";

const MODEL_ID = "claude-sonnet-4-6";
const MAX_HTML_BYTES = 30000;

export interface RoadmapInput {
  chapters: { heading: string; prose: string }[];
  requirements: { key: string; title: string; status: "planned" | "building" | "shipped" }[];
}

const SYSTEM = `You produce ONE self-contained HTML "roadmap" graphic for a software project —
a horizontal timeline of the journey so far and what's next, for a quick at-a-glance read by anyone.
Rules:
- Output ONLY one HTML document. No prose, no markdown, no code fences.
- Inline <style> only. No external resources, no <script>, no network.
- Layout: a horizontal SPINE timeline (a thin teal/verdigris line) running left -> right with milestone
  nodes (dots) along it, grouped into a few phases. Left = earliest/shipped, right = upcoming/next.
- Show each milestone's status with BOTH an icon and a color and a short label (never color alone):
  shipped = check + green, in progress = half-circle + amber, planned/next = hollow circle + muted grey.
- Include a small legend of the three statuses.
- Aesthetic: light "paper" background (~#FAF8F3), dark ink text (~#1A1A1A), hairline borders (~#E5E0D8),
  a verdigris/teal accent (~#2E7D74) for the spine; clean modern sans headings, a monospace for small
  labels/keys (REQ ids). Calm, lots of whitespace, ~1100px wide. Well under 30KB.
- Ground EVERY milestone in the data given: the chapters are the journey; the requirements are the real
  status. Do NOT invent phases, dates, or features not present. Keep labels short.
- Keep it COMPACT and WIDE so it reads without much vertical scrolling: lay the phases out left-to-right,
  fit comfortably within roughly a 1000x800 area, and set the body width to ~100% (max ~1100px).`;

function buildUserMessage(input: RoadmapInput): string {
  const chapters = input.chapters.map((c, i) => `${i + 1}. ${c.heading} — ${c.prose}`).join("\n");
  const group = (s: RoadmapInput["requirements"][number]["status"]) =>
    input.requirements.filter((r) => r.status === s).map((r) => `${r.key} ${r.title}`).join("; ") || "(none)";
  return `## The journey so far (narrative chapters)\n${chapters || "(none)"}\n\n## Real requirement status (ground truth)\n- Shipped: ${group("shipped")}\n- In progress (building): ${group("building")}\n- Planned (what's next): ${group("planned")}\n\nDraw the roadmap now, grounded strictly in the above.`;
}

export async function generateRoadmapHtml(
  input: RoadmapInput,
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
