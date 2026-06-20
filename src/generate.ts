import fs from "node:fs";
import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { loadDotenv } from "./env";
import { parseConfig } from "./config";
import { loadIdea, loadSpec, loadConventions } from "./inputs";
import { buildSlice } from "./repoSlice";
import { GenerationOutputSchema, semanticErrors } from "./schema";
import { SYSTEM_PROMPT, buildUserMessage, correctiveMessage } from "./prompt";
import { createClient, callModel } from "./anthropic";
import { estimateTokens } from "./tokens";

function log(verbose: boolean, ...args: unknown[]): void {
  if (verbose) console.error("[generate]", ...args);
}

async function main(): Promise<void> {
  loadDotenv();
  const cfg = parseConfig(process.argv.slice(2));

  const idea = loadIdea(cfg.ideaPath);
  const spec = loadSpec(cfg.specPath);
  const conventions = loadConventions(cfg.claudePath);

  // Spec + conventions + idea are always included in full; the repo slice gets
  // whatever budget remains.
  const fixedTokens =
    estimateTokens(spec.text) +
    estimateTokens(conventions ?? "") +
    estimateTokens(idea.title + idea.why) +
    estimateTokens(SYSTEM_PROMPT) +
    800; // misc template overhead
  const sliceBudget = Math.max(0, cfg.maxContextTokens - fixedTokens);
  log(cfg.verbose, `fixed context ≈ ${fixedTokens} tok; slice budget ≈ ${sliceBudget} tok`);

  const slice = buildSlice({
    repoPath: cfg.repoPath,
    excludeAbs: [cfg.specPath, cfg.claudePath],
    ideaTitle: idea.title,
    ideaWhy: idea.why,
    includes: cfg.include,
    relevantPaths: idea.relevantPaths ?? [],
    budgetTokens: sliceBudget,
  });
  log(
    cfg.verbose,
    `slice: ${slice.files.length} file(s) in, ${slice.omitted.length} omitted, nearEmpty=${slice.nearEmpty}`,
  );

  const userMessage = buildUserMessage({
    conventions,
    existingList: spec.existingList,
    nextKey: spec.nextKey,
    specText: spec.text,
    idea,
    slice,
  });

  if (cfg.dryRun) {
    const userTokens = estimateTokens(userMessage);
    console.error("[dry-run] no API call made.");
    console.error(`  spec: ${spec.existingKeys.size} existing REQ keys, max ${spec.maxNumber}, next ${spec.nextKey}`);
    console.error(`  slice: ${slice.files.length} file(s) included${slice.files.length ? " — " + slice.files.map((f) => f.relPath + (f.truncated ? " (trunc)" : "")).join(", ") : ""}`);
    if (slice.omitted.length) console.error(`  omitted: ${slice.omitted.join(", ")}`);
    console.error(`  near-empty repo: ${slice.nearEmpty}`);
    console.error(`  user-message ≈ ${userTokens} tok; system ≈ ${estimateTokens(SYSTEM_PROMPT)} tok`);
    if (cfg.outPath) {
      fs.mkdirSync(path.dirname(cfg.outPath), { recursive: true });
      fs.writeFileSync(cfg.outPath, `===== SYSTEM =====\n${SYSTEM_PROMPT}\n\n===== USER =====\n${userMessage}\n`, "utf8");
      console.error(`  full prompt written → ${cfg.outPath}`);
    }
    return;
  }

  const client = createClient();
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: userMessage }];

  let lastFailure = "unknown error";
  let usage: { input_tokens: number; output_tokens: number } | null = null;

  for (let attempt = 0; attempt <= cfg.maxRetries; attempt++) {
    log(cfg.verbose, `attempt ${attempt + 1}/${cfg.maxRetries + 1} → ${cfg.modelId}`);
    const result = await callModel({
      client,
      modelId: cfg.modelId,
      system: SYSTEM_PROMPT,
      messages,
      maxTokens: 16000,
      thinking: cfg.thinking,
    });
    if (result.message?.usage) {
      usage = {
        input_tokens: result.message.usage.input_tokens,
        output_tokens: result.message.usage.output_tokens,
      };
    }

    if (result.failure || result.obj == null) {
      lastFailure = result.failure ?? "no output produced";
      log(cfg.verbose, `failure: ${lastFailure}`);
      if (!result.retryable) break; // API/transport error or refusal — retrying won't help
      if (result.message) messages.push({ role: "assistant", content: result.message.content });
      messages.push({ role: "user", content: correctiveMessage([lastFailure]) });
      continue;
    }

    const parsed = GenerationOutputSchema.safeParse(result.obj);
    if (!parsed.success) {
      const errs = parsed.error.issues.map(
        (i) => `${i.path.join(".") || "(root)"}: ${i.message}`,
      );
      lastFailure = `schema validation: ${errs.join("; ")}`;
      log(cfg.verbose, lastFailure);
      messages.push({ role: "assistant", content: result.message!.content });
      messages.push({ role: "user", content: correctiveMessage(errs) });
      continue;
    }

    const errs = semanticErrors(parsed.data, {
      existingKeys: spec.existingKeys,
      nextNumber: spec.nextNumber,
    });
    if (errs.length) {
      lastFailure = `semantic validation: ${errs.join("; ")}`;
      log(cfg.verbose, lastFailure);
      messages.push({ role: "assistant", content: result.message!.content });
      messages.push({ role: "user", content: correctiveMessage(errs) });
      continue;
    }

    // Success — assemble output and write it.
    const output = {
      idea: { title: idea.title },
      model: cfg.modelId,
      generated_at: new Date().toISOString(),
      usage,
      new_requirements: parsed.data.new_requirements.map((nr) => ({
        key: nr.key,
        title: nr.title,
        description: nr.description,
        provenance: "voted" as const,
      })),
      tasks: parsed.data.tasks,
    };
    const json = JSON.stringify(output, null, 2);
    const summary = `${output.tasks.length} task(s), ${output.new_requirements.length} new requirement(s)`;
    if (cfg.outPath) {
      fs.mkdirSync(path.dirname(cfg.outPath), { recursive: true });
      fs.writeFileSync(cfg.outPath, json + "\n", "utf8");
      console.error(`[generate] ${summary} → ${cfg.outPath}`);
    } else {
      process.stdout.write(json + "\n");
      console.error(`[generate] ${summary} (${cfg.modelId})`);
    }
    return;
  }

  console.error(`\ngeneration failed — retry`);
  console.error(`last reason: ${lastFailure}`);
  process.exit(1);
}

main().catch((e) => {
  console.error("generation failed — retry");
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
