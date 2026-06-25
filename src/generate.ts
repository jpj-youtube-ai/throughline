import fs from "node:fs";
import path from "node:path";
import { loadDotenv } from "./env";
import { parseConfig } from "./config";
import { loadIdea, loadSpec, loadConventions } from "./inputs";
import { buildSlice } from "./repoSlice";
import { SYSTEM_PROMPT, buildUserMessage } from "./prompt";
import { generateTasks } from "./generation/run";
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

  const result = await generateTasks({
    modelId: cfg.modelId,
    userMessage,
    existingKeys: spec.existingKeys,
    nextNumber: spec.nextNumber,
    prototypeLabels: [],
    maxRetries: cfg.maxRetries,
    thinking: cfg.thinking,
    onLog: (m) => log(cfg.verbose, m),
  });

  if (!result.ok) {
    console.error(`\ngeneration failed — retry`);
    console.error(`last reason: ${result.failure}`);
    process.exit(1);
  }

  const output = {
    idea: { title: idea.title },
    model: result.model,
    generated_at: new Date().toISOString(),
    usage: result.usage,
    new_requirements: result.output.new_requirements.map((nr) => ({
      key: nr.key,
      title: nr.title,
      description: nr.description,
      provenance: "voted" as const,
    })),
    tasks: result.output.tasks,
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
}

main().catch((e) => {
  console.error("generation failed — retry");
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
