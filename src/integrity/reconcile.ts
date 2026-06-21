import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { Db } from "../db/client";
import { requirements, tasks, project } from "../db/schema";
import { createClient } from "../anthropic";
import { renderSpec, type SpecRequirement, type SpecTaskRef } from "../spec/render";
import { buildSlice } from "../repoSlice";

// Is the materialized SPEC.md stale relative to what the requirements render to?
export function reconcileSpec(renderedSpec: string, currentSpec: string): { stale: boolean } {
  return { stale: renderedSpec.trim() !== currentSpec.trim() };
}

export interface StructuralReconciliation {
  specStale: boolean;
  requirementCount: number;
  rendered: string;
}

// The cheap, no-LLM half: compare the current SPEC.md (passed in) to what the
// requirements table renders to.
export async function reconcileStructural(db: Db, currentSpec: string): Promise<StructuralReconciliation> {
  const reqs: SpecRequirement[] = await db
    .select({
      key: requirements.key,
      title: requirements.title,
      description: requirements.description,
      status: requirements.status,
    })
    .from(requirements);
  const taskRefs: SpecTaskRef[] = await db
    .select({ key: tasks.key, title: tasks.title, requirementKey: requirements.key })
    .from(tasks)
    .innerJoin(requirements, eq(tasks.requirementId, requirements.id));
  const rendered = renderSpec(reqs, taskRefs);
  return { specStale: reconcileSpec(rendered, currentSpec).stale, requirementCount: reqs.length, rendered };
}

const CodeSchema = z
  .object({
    unmapped_code: z
      .array(z.string())
      .describe(
        "Implemented features or significant code areas that map to NO requirement. Empty if everything maps.",
      ),
  })
  .strict();

export type DetectUnmappedResult = { ok: true; unmappedCode: string[] } | { ok: false; failure: string };

// The LLM half: code/features mapping to no requirement.
export async function detectUnmappedCode(args: {
  repoText: string;
  requirementsList: string;
  modelId?: string;
  client?: Anthropic;
}): Promise<DetectUnmappedResult> {
  const client = args.client ?? createClient();
  const system = `You are reconciling a codebase against its requirements. Given a slice of the repository and the list of requirements, identify implemented features or significant code areas that map to NO requirement — capabilities the code has that no REQ describes. Be conservative: list genuine unmapped features, not boilerplate, config, or incidental files. Empty list if everything maps.`;
  const user = `## Requirements\n${args.requirementsList}\n\n## Repository slice\n${args.repoText}\n\nList code/features that map to no requirement.`;

  let message: Anthropic.Message;
  try {
    message = await client.messages.create({
      model: args.modelId ?? "claude-opus-4-8",
      max_tokens: 4000,
      system,
      thinking: { type: "adaptive" },
      output_config: { format: zodOutputFormat(CodeSchema) },
      messages: [{ role: "user", content: user }],
    });
  } catch (e) {
    return { ok: false, failure: `API error: ${(e as Error).message}` };
  }
  const tb = message.content.find((b) => b.type === "text") as Anthropic.TextBlock | undefined;
  if (!tb) return { ok: false, failure: "no output from the model" };
  try {
    const parsed = CodeSchema.safeParse(JSON.parse(tb.text));
    if (!parsed.success) return { ok: false, failure: "malformed output" };
    return { ok: true, unmappedCode: parsed.data.unmapped_code };
  } catch {
    return { ok: false, failure: "output was not valid JSON" };
  }
}

export interface DashboardReconciliation {
  bound: boolean;
  specStale: boolean;
  requirementCount: number;
}

/**
 * The dashboard's cheap reconcile read: structural staleness + requirement count,
 * no LLM. Returns bound:false (and skips the file read) when no repo is bound yet.
 */
export async function structuralReconciliationForProject(db: Db): Promise<DashboardReconciliation> {
  const [proj] = await db.select().from(project).limit(1);
  if (!proj) {
    const reqs = await db.select({ key: requirements.key }).from(requirements);
    return { bound: false, specStale: false, requirementCount: reqs.length };
  }
  const specFile = path.join(proj.localClonePath, proj.specPath);
  const currentSpec = fs.existsSync(specFile) ? fs.readFileSync(specFile, "utf8") : "";
  const s = await reconcileStructural(db, currentSpec);
  return { bound: true, specStale: s.specStale, requirementCount: s.requirementCount };
}

export interface ReconciliationReport {
  specStale: boolean;
  requirementCount: number;
  unmappedCode: string[];
  codeReconciliation: "ok" | "failed";
  codeFailure?: string;
}

/**
 * Full reconciliation (REQ-015): report spec staleness (structural) and code
 * mapping to no requirement (LLM). Read-only — lists divergences, never applies.
 * Re-materializing is a separate explicit action (materializeSpec).
 */
export async function reconcile(db: Db): Promise<ReconciliationReport> {
  const [proj] = await db.select().from(project).limit(1);
  if (!proj) throw new Error("No project bound (REQ-002).");

  const specFile = path.join(proj.localClonePath, proj.specPath);
  const currentSpec = fs.existsSync(specFile) ? fs.readFileSync(specFile, "utf8") : "";
  const structural = await reconcileStructural(db, currentSpec);

  const reqs = await db.select({ key: requirements.key, title: requirements.title }).from(requirements);
  const requirementsList = reqs.map((r) => `- ${r.key} — ${r.title}`).join("\n");
  const slice = buildSlice({
    repoPath: proj.localClonePath,
    excludeAbs: [specFile, path.join(proj.localClonePath, proj.claudeMdPath)],
    ideaTitle: "reconciliation",
    ideaWhy: "find code mapping to no requirement",
    includes: [],
    relevantPaths: [],
    budgetTokens: 30000,
  });
  const repoText = slice.tree + "\n\n" + slice.files.map((f) => `### ${f.relPath}\n${f.content}`).join("\n\n");

  const code = await detectUnmappedCode({ repoText, requirementsList });
  return {
    specStale: structural.specStale,
    requirementCount: structural.requirementCount,
    unmappedCode: code.ok ? code.unmappedCode : [],
    codeReconciliation: code.ok ? "ok" : "failed",
    codeFailure: code.ok ? undefined : code.failure,
  };
}
