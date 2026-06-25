import type Anthropic from "@anthropic-ai/sdk";
import { GenerationOutputSchema, semanticErrors, type GenerationOutput } from "../schema";
import { SYSTEM_PROMPT, correctiveMessage } from "../prompt";
import { createClient, callModel } from "../anthropic";

export type Usage = { input_tokens: number; output_tokens: number } | null;

export type GenerateTasksResult =
  | { ok: true; output: GenerationOutput; usage: Usage; model: string }
  | { ok: false; failure: string; usage: Usage };

export interface GenerateTasksArgs {
  modelId: string;
  userMessage: string; // assembled prompt (conventions + spec + idea + repo slice)
  existingKeys: Set<string>; // existing REQ keys, for link validation
  nextNumber: number; // next available REQ number, for new-req validation
  maxRetries: number;
  thinking: boolean;
  maxTokens?: number;
  client?: Anthropic; // defaults to createClient()
  onLog?: (msg: string) => void;
}

/**
 * The generation core (REQ-008): call the model for structured tasks, validate
 * (schema + semantic: REQ-link resolution, monotonic numbering), and on
 * malformed output feed the errors back and retry. Returns a clean result —
 * never a partial. Extracted from the CLI so the CLI and the worker share it.
 */
export async function generateTasks(args: GenerateTasksArgs): Promise<GenerateTasksResult> {
  const client = args.client ?? createClient();
  const log = args.onLog ?? (() => {});
  const maxTokens = args.maxTokens ?? 16000;
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: args.userMessage }];

  let lastFailure = "unknown error";
  let usage: Usage = null;

  for (let attempt = 0; attempt <= args.maxRetries; attempt++) {
    log(`attempt ${attempt + 1}/${args.maxRetries + 1} → ${args.modelId}`);
    const result = await callModel({
      client,
      modelId: args.modelId,
      system: SYSTEM_PROMPT,
      messages,
      maxTokens,
      thinking: args.thinking,
    });
    if (result.message?.usage) {
      usage = {
        input_tokens: result.message.usage.input_tokens,
        output_tokens: result.message.usage.output_tokens,
      };
    }

    if (result.failure || result.obj == null) {
      lastFailure = result.failure ?? "no output produced";
      log(`failure: ${lastFailure}`);
      if (!result.retryable) break; // API/transport error or refusal — retrying won't help
      if (result.message) messages.push({ role: "assistant", content: result.message.content });
      messages.push({ role: "user", content: correctiveMessage([lastFailure]) });
      continue;
    }

    const parsed = GenerationOutputSchema.safeParse(result.obj);
    if (!parsed.success) {
      const errs = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
      lastFailure = `schema validation: ${errs.join("; ")}`;
      log(lastFailure);
      messages.push({ role: "assistant", content: result.message!.content });
      messages.push({ role: "user", content: correctiveMessage(errs) });
      continue;
    }

    const errs = semanticErrors(parsed.data, {
      existingKeys: args.existingKeys,
      nextNumber: args.nextNumber,
    });
    if (errs.length) {
      lastFailure = `semantic validation: ${errs.join("; ")}`;
      log(lastFailure);
      messages.push({ role: "assistant", content: result.message!.content });
      messages.push({ role: "user", content: correctiveMessage(errs) });
      continue;
    }

    return { ok: true, output: parsed.data, usage, model: args.modelId };
  }

  return { ok: false, failure: lastFailure, usage };
}
