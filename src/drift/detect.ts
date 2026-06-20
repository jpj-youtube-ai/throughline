import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { createClient } from "../anthropic";

const DriftSchema = z
  .object({
    unmapped_items: z
      .array(z.string())
      .describe(
        "Concrete pieces of work in the diff NOT covered by the requirement (features, files, behaviors belonging to a different concern). Empty if everything is on-scope.",
      ),
  })
  .strict();

const SYSTEM = `You are a code reviewer checking a pull request for scope drift. You are given a PR diff and the single requirement it claims to implement. Identify concrete pieces of work in the diff that are NOT covered by that requirement — features, files, or behaviors that belong to a different concern or requirement. Be precise and conservative: only flag genuine out-of-scope work, not refactors, tests, or incidental changes that serve the requirement. If everything maps to the requirement, return an empty list.`;

export type DetectDriftResult = { ok: true; unmappedItems: string[] } | { ok: false; failure: string };

export interface DetectDriftArgs {
  diff: string;
  requirementKey: string;
  requirementTitle: string;
  requirementDescription: string;
  modelId?: string;
  client?: Anthropic;
}

/**
 * Detect scope drift (REQ-013): ask the model which changes in a PR diff are not
 * covered by the task's requirement. Returns the unmapped items (flag, never
 * auto-resolve). Live — needs the Anthropic API.
 */
export async function detectDrift(args: DetectDriftArgs): Promise<DetectDriftResult> {
  const client = args.client ?? createClient();
  const user = `## Requirement
${args.requirementKey} — ${args.requirementTitle}
${args.requirementDescription}

## PR diff
\`\`\`diff
${args.diff}
\`\`\`

List the out-of-scope (unmapped) items.`;

  let message: Anthropic.Message;
  try {
    message = await client.messages.create({
      model: args.modelId ?? "claude-opus-4-8",
      max_tokens: 4000,
      system: SYSTEM,
      thinking: { type: "adaptive" },
      output_config: { format: zodOutputFormat(DriftSchema) },
      messages: [{ role: "user", content: user }],
    });
  } catch (e) {
    return { ok: false, failure: `API error: ${(e as Error).message}` };
  }

  const textBlock = message.content.find((b) => b.type === "text") as Anthropic.TextBlock | undefined;
  if (!textBlock) return { ok: false, failure: "no output from the model" };
  try {
    const parsed = DriftSchema.safeParse(JSON.parse(textBlock.text));
    if (!parsed.success) return { ok: false, failure: "malformed drift output" };
    return { ok: true, unmappedItems: parsed.data.unmapped_items };
  } catch {
    return { ok: false, failure: "drift output was not valid JSON" };
  }
}
