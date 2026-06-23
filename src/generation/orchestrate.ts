import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { ideas, requirements, tasks, project } from "../db/schema";
import { buildSlice, type BuildSliceOptions, type RepoSlice } from "../repoSlice";
import { SYSTEM_PROMPT, buildUserMessage } from "../prompt";
import { estimateTokens } from "../tokens";
import { generateTasks } from "./run";
import type { generateTasks as GenerateTasksFn } from "./run";
import { persistGeneration, persistGenerationForRequirement } from "./persist";

const MODEL_ID = "claude-opus-4-8";
const MAX_CONTEXT_TOKENS = 40000;

export interface GenerateForIdeaResult {
  ok: boolean;
  failure?: string;
  taskKeys?: string[];
}

function reqContextFromDb(reqs: { key: string; title: string }[]) {
  const sorted = [...reqs].sort((a, b) => a.key.localeCompare(b.key));
  const existingKeys = new Set(sorted.map((r) => r.key));
  let max = 0;
  for (const k of existingKeys) {
    const m = /-(\d+)$/.exec(k);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return {
    existingKeys,
    existingList: sorted.map((r) => `- ${r.key} — ${r.title}`).join("\n"),
    nextNumber: max + 1,
    nextKey: `REQ-${String(max + 1).padStart(3, "0")}`,
  };
}

/**
 * Generate and persist tasks for one approved idea (REQ-008). Assembles context
 * from the bound repo's local clone (spec + a curated slice) and the requirements
 * table, runs the generator, and persists on success. On generation failure it
 * persists nothing — no partial tasks.
 */
export async function generateForApprovedIdea(db: Db, ideaId: string): Promise<GenerateForIdeaResult> {
  const [idea] = await db.select().from(ideas).where(eq(ideas.id, ideaId)).limit(1);
  if (!idea) return { ok: false, failure: "idea not found" };
  if (idea.state !== "approved") return { ok: false, failure: `idea is ${idea.state}, not approved` };
  if (!idea.why) return { ok: false, failure: "idea has no why" };
  const why = idea.why;

  const [proj] = await db.select().from(project).where(eq(project.id, idea.projectId)).limit(1);
  if (!proj) return { ok: false, failure: `project ${idea.projectId} not found (REQ-002)` };

  const specPath = path.join(proj.localClonePath, proj.specPath);
  const claudePath = path.join(proj.localClonePath, proj.claudeMdPath);
  const specText = fs.existsSync(specPath) ? fs.readFileSync(specPath, "utf8") : "";
  const conventions = fs.existsSync(claudePath) ? fs.readFileSync(claudePath, "utf8") : null;

  const ctx = reqContextFromDb(await db.select({ key: requirements.key, title: requirements.title }).from(requirements).where(eq(requirements.projectId, proj.id)));

  const fixed =
    estimateTokens(specText) +
    estimateTokens(conventions ?? "") +
    estimateTokens(idea.title + why) +
    estimateTokens(SYSTEM_PROMPT) +
    800;
  const slice = buildSlice({
    repoPath: proj.localClonePath,
    excludeAbs: [specPath, claudePath],
    ideaTitle: idea.title,
    ideaWhy: why,
    includes: proj.contextPins,
    relevantPaths: [],
    budgetTokens: Math.max(0, MAX_CONTEXT_TOKENS - fixed),
  });

  const userMessage = buildUserMessage({
    conventions,
    existingList: ctx.existingList,
    nextKey: ctx.nextKey,
    specText,
    idea: { title: idea.title, why, feasibility: idea.feasibility, viability: idea.viability },
    slice,
  });

  const result = await generateTasks({
    modelId: MODEL_ID,
    userMessage,
    existingKeys: ctx.existingKeys,
    nextNumber: ctx.nextNumber,
    maxRetries: 2,
    thinking: true,
  });

  if (!result.ok) return { ok: false, failure: result.failure }; // no persist → no partial tasks

  const { taskKeys } = await persistGeneration(db, {
    ideaId,
    output: result.output,
    model: result.model,
    usage: result.usage,
  });
  return { ok: true, taskKeys };
}

export interface GenerateForRequirementResult {
  ok: boolean;
  failure?: string;
  taskKeys?: string[];
}

/**
 * Generate and persist tasks for one approved/imported requirement (REQ-008,
 * requirement-driven). Mirrors generateForApprovedIdea but seeds the generator
 * from the requirement (title + description). Produces tasks only — persist forces
 * every task onto this requirement. `opts.generate` is injectable for tests.
 */
export async function generateForRequirement(
  db: Db,
  reqId: string,
  opts?: { generate?: typeof GenerateTasksFn; buildSlice?: (o: BuildSliceOptions) => RepoSlice },
): Promise<GenerateForRequirementResult> {
  const generate = opts?.generate ?? generateTasks;
  const buildSliceFn = opts?.buildSlice ?? buildSlice;

  const [req] = await db
    .select({ id: requirements.id, title: requirements.title, description: requirements.description, projectId: requirements.projectId })
    .from(requirements)
    .where(eq(requirements.id, reqId))
    .limit(1);
  if (!req) return { ok: false, failure: "requirement not found" };

  const existingForReq = await db.select({ id: tasks.id }).from(tasks).where(eq(tasks.requirementId, reqId)).limit(1);
  if (existingForReq.length > 0) return { ok: false, failure: "requirement already has tasks" };

  const [proj] = await db.select().from(project).where(eq(project.id, req.projectId)).limit(1);
  if (!proj) return { ok: false, failure: `project ${req.projectId} not found (REQ-002)` };

  const specPath = path.join(proj.localClonePath, proj.specPath);
  const claudePath = path.join(proj.localClonePath, proj.claudeMdPath);
  const specText = fs.existsSync(specPath) ? fs.readFileSync(specPath, "utf8") : "";
  const conventions = fs.existsSync(claudePath) ? fs.readFileSync(claudePath, "utf8") : null;

  const ctx = reqContextFromDb(await db.select({ key: requirements.key, title: requirements.title }).from(requirements).where(eq(requirements.projectId, proj.id)));
  const seedWhy = req.description || req.title;

  const fixed =
    estimateTokens(specText) +
    estimateTokens(conventions ?? "") +
    estimateTokens(req.title + seedWhy) +
    estimateTokens(SYSTEM_PROMPT) +
    800;
  const slice = buildSliceFn({
    repoPath: proj.localClonePath,
    excludeAbs: [specPath, claudePath],
    ideaTitle: req.title,
    ideaWhy: seedWhy,
    includes: proj.contextPins,
    relevantPaths: [],
    budgetTokens: Math.max(0, MAX_CONTEXT_TOKENS - fixed),
  });

  const userMessage = buildUserMessage({
    conventions,
    existingList: ctx.existingList,
    nextKey: ctx.nextKey,
    specText,
    idea: { title: req.title, why: seedWhy, feasibility: null, viability: null },
    slice,
  });

  const result = await generate({
    modelId: MODEL_ID,
    userMessage,
    existingKeys: ctx.existingKeys,
    nextNumber: ctx.nextNumber,
    maxRetries: 2,
    thinking: true,
  });
  if (!result.ok) return { ok: false, failure: result.failure };

  const { taskKeys } = await persistGenerationForRequirement(db, {
    reqId,
    output: result.output,
    model: result.model,
    usage: result.usage,
  });
  return { ok: true, taskKeys };
}
