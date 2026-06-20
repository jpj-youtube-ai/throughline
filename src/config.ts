import { parseArgs } from "node:util";
import path from "node:path";

export type ModelChoice = "opus" | "sonnet";

const MODEL_IDS: Record<ModelChoice, string> = {
  opus: "claude-opus-4-8",
  sonnet: "claude-sonnet-4-6",
};

export interface Config {
  ideaPath: string; // path, or "-" for stdin
  specPath: string;
  repoPath: string;
  claudePath: string; // conventions file (target repo's CLAUDE.md)
  model: ModelChoice;
  modelId: string;
  outPath: string | null; // null = stdout
  maxContextTokens: number;
  maxRetries: number;
  include: string[]; // globs forced into the slice
  thinking: boolean;
  dryRun: boolean; // build context, skip the API call
  verbose: boolean;
}

export function parseConfig(argv: string[]): Config {
  const { values } = parseArgs({
    args: argv,
    options: {
      idea: { type: "string" },
      spec: { type: "string", default: "./SPEC.md" },
      repo: { type: "string", default: "." },
      claude: { type: "string" },
      model: { type: "string", default: "opus" },
      out: { type: "string" },
      "max-context-tokens": { type: "string", default: "40000" },
      "max-retries": { type: "string", default: "2" },
      include: { type: "string", multiple: true, default: [] },
      "no-thinking": { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
      verbose: { type: "boolean", default: false },
    },
    allowPositionals: false,
  });

  if (!values.idea) {
    throw new Error("Missing required --idea <path|-> (idea JSON file, or '-' for stdin).");
  }

  const model = values.model as string;
  if (model !== "opus" && model !== "sonnet") {
    throw new Error(`--model must be 'opus' or 'sonnet' (got '${model}').`);
  }

  const repoPath = path.resolve(values.repo as string);
  const claudePath = values.claude
    ? path.resolve(values.claude as string)
    : path.join(repoPath, "CLAUDE.md");

  const maxContextTokens = Number(values["max-context-tokens"]);
  const maxRetries = Number(values["max-retries"]);
  if (!Number.isFinite(maxContextTokens) || maxContextTokens <= 0) {
    throw new Error("--max-context-tokens must be a positive number.");
  }
  if (!Number.isFinite(maxRetries) || maxRetries < 0) {
    throw new Error("--max-retries must be a non-negative number.");
  }

  return {
    ideaPath: values.idea as string,
    specPath: path.resolve(values.spec as string),
    repoPath,
    claudePath,
    model,
    modelId: MODEL_IDS[model],
    outPath: values.out ? path.resolve(values.out as string) : null,
    maxContextTokens,
    maxRetries,
    include: (values.include as string[]) ?? [],
    thinking: !(values["no-thinking"] as boolean),
    dryRun: values["dry-run"] as boolean,
    verbose: values.verbose as boolean,
  };
}
