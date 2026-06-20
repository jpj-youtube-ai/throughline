import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { createClient } from "../anthropic";

const NarrativeSchema = z
  .object({
    chapters: z
      .array(
        z
          .object({
            heading: z.string().describe("A short chapter heading (a few words)."),
            prose: z
              .string()
              .describe("2–5 sentences of narrative, in past tense, grounded strictly in the events."),
            refs: z
              .array(z.string())
              .describe("REQ/TASK keys (or actors) this chapter references, taken from the events. May be empty."),
          })
          .strict(),
      )
      .describe("Chronological chapters telling the project's story so far."),
  })
  .strict();

export type NarrativeContent = z.infer<typeof NarrativeSchema>;

export type GenerateNarrativeResult = { ok: true; content: NarrativeContent } | { ok: false; failure: string };

const SYSTEM = `You are the project's historian. You are given a chronological log of decisions — each line has who acted, what they did, and often why. Write the project's story so far as a short sequence of chapters (aim for 3–6). Ground every statement in the log: do not invent features, people, dates, or motivations that are not present. Weave in the recorded "why" where it exists. Write in plain past tense, concise and factual — a logbook history, not marketing copy.`;

export async function generateNarrative(args: {
  eventDigest: string;
  modelId?: string;
  client?: Anthropic;
}): Promise<GenerateNarrativeResult> {
  const client = args.client ?? createClient();
  const user = `## Event log (chronological)\n${args.eventDigest}\n\nWrite the narrative as grounded chapters.`;

  let message: Anthropic.Message;
  try {
    message = await client.messages.create({
      model: args.modelId ?? "claude-opus-4-8",
      max_tokens: 6000,
      system: SYSTEM,
      thinking: { type: "adaptive" },
      output_config: { format: zodOutputFormat(NarrativeSchema) },
      messages: [{ role: "user", content: user }],
    });
  } catch (e) {
    return { ok: false, failure: `API error: ${(e as Error).message}` };
  }

  const tb = message.content.find((b) => b.type === "text") as Anthropic.TextBlock | undefined;
  if (!tb) return { ok: false, failure: "no output from the model" };
  try {
    const parsed = NarrativeSchema.safeParse(JSON.parse(tb.text));
    if (!parsed.success) return { ok: false, failure: "malformed narrative output" };
    return { ok: true, content: parsed.data };
  } catch {
    return { ok: false, failure: "narrative output was not valid JSON" };
  }
}
