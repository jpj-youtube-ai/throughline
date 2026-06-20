import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { createClient } from "../anthropic";

const DigestSchema = z
  .object({
    summary: z
      .string()
      .describe(
        "A brief outbound digest, 2–4 plain sentences. No greeting, sign-off, or markdown headings. Grounded strictly in the events.",
      ),
  })
  .strict();

export type ComposeResult = { ok: true; text: string } | { ok: false; failure: string };

export type ComposeFn = (args: { eventDigest: string; since: string | null }) => Promise<ComposeResult>;

const SYSTEM = `You write a short outbound digest of a project's recent decisions for the team's channel. Summarise what happened and why in 2–4 plain sentences, grounded strictly in the events given — do not invent work, names, or numbers. No greeting, no sign-off, no markdown headings; just the prose.`;

/**
 * Compose the prose digest (REQ-026) from the recent events. Live — needs the
 * Anthropic API; returns ok/failure so a scheduled run can skip cleanly on error
 * rather than throw.
 */
export const composeDigest: ComposeFn = async ({ eventDigest, since }) => {
  const client = createClient();
  const window = since ? `since ${since}` : "since the project began";
  let message: Anthropic.Message;
  try {
    message = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 2000,
      system: SYSTEM,
      thinking: { type: "adaptive" },
      output_config: { format: zodOutputFormat(DigestSchema) },
      messages: [{ role: "user", content: `Recent decisions (${window}):\n${eventDigest}\n\nWrite the digest.` }],
    });
  } catch (e) {
    return { ok: false, failure: `API error: ${(e as Error).message}` };
  }
  const tb = message.content.find((b) => b.type === "text") as Anthropic.TextBlock | undefined;
  if (!tb) return { ok: false, failure: "no output from the model" };
  try {
    const parsed = DigestSchema.safeParse(JSON.parse(tb.text));
    if (!parsed.success) return { ok: false, failure: "malformed digest output" };
    return { ok: true, text: parsed.data.summary.trim() };
  } catch {
    return { ok: false, failure: "digest output was not valid JSON" };
  }
};
