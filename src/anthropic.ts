import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { GenerationOutputSchema } from "./schema";

export interface ModelCallResult {
  message: Anthropic.Message | null;
  obj: unknown | null; // parsed JSON (not yet zod-validated)
  failure: string | null; // set when no usable JSON object was produced
  // Whether a corrective retry could plausibly help. API/transport errors and
  // refusals are not retryable here; malformed/truncated output is.
  retryable: boolean;
}

export function createClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Provide it in the environment (never in the repo).",
    );
  }
  return new Anthropic();
}

export async function callModel(args: {
  client: Anthropic;
  modelId: string;
  system: string;
  messages: Anthropic.MessageParam[];
  maxTokens: number;
  thinking: boolean;
}): Promise<ModelCallResult> {
  let message: Anthropic.Message;
  try {
    message = await args.client.messages.create({
      model: args.modelId,
      max_tokens: args.maxTokens,
      system: args.system,
      ...(args.thinking ? { thinking: { type: "adaptive" } } : {}),
      output_config: { format: zodOutputFormat(GenerationOutputSchema) },
      messages: args.messages,
    });
  } catch (e) {
    // The SDK already retried transient errors (429/5xx); anything thrown here
    // is a non-retryable client/transport error (billing, auth, bad request).
    return { message: null, obj: null, failure: `API error: ${(e as Error).message}`, retryable: false };
  }

  if (message.stop_reason === "refusal") {
    return { message, obj: null, failure: "the model refused the request", retryable: false };
  }
  if (message.stop_reason === "max_tokens") {
    return { message, obj: null, failure: "output hit max_tokens (truncated)", retryable: true };
  }

  const textBlock = message.content.find((b) => b.type === "text") as
    | Anthropic.TextBlock
    | undefined;
  if (!textBlock) {
    return { message, obj: null, failure: "no text block in the response", retryable: true };
  }

  try {
    return { message, obj: JSON.parse(textBlock.text), failure: null, retryable: true };
  } catch {
    return { message, obj: null, failure: "response was not valid JSON", retryable: true };
  }
}
