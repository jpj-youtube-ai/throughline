import type { Idea } from "./inputs";
import type { RepoSlice } from "./repoSlice";

export const SYSTEM_PROMPT = `You are a senior engineer and tech lead for the software project described below. Your job: turn ONE approved idea into a small set of concrete, well-scoped engineering tasks that an AI coding agent (Claude Code) will implement, each linked to a requirement in the project's spec.

You are given: the project's conventions (CLAUDE.md), its current spec (requirements, REQ-NNN), the approved idea, and a curated slice of the target repository (a file tree plus a few relevant files). The repository may be nearly empty — a new project with little or no code yet. If so, produce foundational/bootstrap tasks and do not reference files that don't exist.

Rules:
- Produce as FEW tasks as cleanly cover the idea — typically 1 to 5. Prefer fewer, well-scoped tasks over many fragments. Each task must be independently implementable and reviewable, sized to one pull request.
- Every task MUST link to exactly one requirement via requirement_key. Prefer an existing REQ-NNN from the spec when one genuinely fits. If none fits, declare a NEW requirement in new_requirements (continue numbering from the "next available" number given below) and link the task to it. Never invent or reuse an existing REQ id for work it does not describe. Every new requirement you declare must be used by at least one task.
- The task body is POINTERS, not a canned prompt and not the code. In pointers, name the specific files, modules, and existing patterns to follow or create (drawn from the repo slice and conventions). In acceptance_check, give a concrete, verifiable condition that proves the task is done (a test to pass, a command's output, an observable behavior). Do not write the implementation, and do not just restate the title.
- effort: integer 1-5 (1 ≈ an hour or two; 5 ≈ large/multi-day). risk: low | med | high. confidence: integer 0-100 (how sure you are the task as written is correct and complete). Be honest: a vague or underspecified idea should yield lower confidence and narrower, more investigative tasks (e.g. "profile X", "measure Y") rather than a confidently-detailed plan. Do not invent false certainty.
- Prerequisites & scope — stay focused on THIS idea. Emit tasks only for: (1) the idea's own work, on its requirement; and (2) at most ONE bootstrap task that stands up the project skeleton and the load-bearing foundation the idea writes through (e.g. the append-only event log + emitEvent helper + base schema module and migrations), linked to the requirement that owns that foundation, and only when it is absent from the repo slice. Do NOT emit tasks that implement OTHER substantial, separately-specified requirements the idea merely depends on (another feature, sign-in/auth, a sibling subsystem and its tables) — those are delivered by their own approved ideas. Instead, name them as dependencies in the relevant task's pointers (e.g. "depends on REQ-001 sign-in and REQ-005 ideas existing"). If a prerequisite already exists in the slice, reuse it and reference it in pointers instead of rebuilding it. Never fold a prerequisite into the idea's own requirement or mislabel it.
- Do not duplicate completed or in-flight work. The "## ALREADY IN THIS PROJECT" section lists tasks already created for this project (each tagged open | claimed | closed) and recent commits that landed on the default branch. Never emit a task that re-implements something already listed there — reuse it and reference it in pointers instead. Emit only tasks that add what is genuinely still missing for the idea.
- Respect the conventions and the project's build order. Do not build features or requirements broader than the idea and its direct prerequisites need — surfacing a genuine prerequisite is not scaffolding ahead, but building unrelated breadth is. Honor the truth model in CLAUDE.md (append-only events; event-write in the same transaction as state) where it bears on the idea.
- You may be given design-prototype screenshots of the product. When present, ground each task's pointers and acceptance_check in the intended design they show (layout, components, copy, flows); do not propose UI that contradicts them. They are reference, not a file to reproduce verbatim.

Return your answer ONLY as the required structured output. No prose outside it.`;

function ideaBlock(idea: Idea): string {
  const feas = idea.feasibility == null ? "n/a" : String(idea.feasibility);
  const via = idea.viability == null ? "n/a" : String(idea.viability);
  return `Title: ${idea.title}
Why: ${idea.why}
Feasibility (1-10): ${feas}   Viability (1-10): ${via}`;
}

function sliceBlock(slice: RepoSlice): string {
  const head = slice.nearEmpty
    ? `Repository: ${slice.repoLabel}  (nearly empty: ${slice.fileCount} eligible file(s) — treat as greenfield)`
    : `Repository: ${slice.repoLabel}`;

  const filesSection = slice.files.length
    ? "\n\nSelected files:\n" +
      slice.files
        .map((f) => `### ${f.relPath}\n\`\`\`${f.lang}\n${f.content}\n\`\`\``)
        .join("\n\n")
    : "\n\n(No file contents selected.)";

  const omitted = slice.omitted.length
    ? `\n\nFiles present but omitted for space: ${slice.omitted.join(", ")}`
    : "";

  return `${head}\n\nFile tree:\n${slice.tree || "(empty)"}${filesSection}${omitted}`;
}

export interface UserMessageParts {
  conventions: string | null;
  existingList: string;
  nextKey: string;
  specText: string;
  idea: Idea;
  slice: RepoSlice;
  taskSummary?: string[];
  recentCommits?: string[];
}

function alreadyBuiltBlock(taskSummary: string[], recentCommits: string[]): string {
  if (taskSummary.length === 0 && recentCommits.length === 0) {
    return "## ALREADY IN THIS PROJECT\n(Nothing built yet — greenfield.)";
  }
  const tasksPart =
    taskSummary.length > 0
      ? `Existing tasks (newest first) — already created; do NOT re-create these:\n${taskSummary.join("\n")}`
      : "Existing tasks: (none yet)";
  const commitsPart =
    recentCommits.length > 0 ? `\n\nRecent commits on the default branch:\n${recentCommits.join("\n")}` : "";
  return `## ALREADY IN THIS PROJECT\n${tasksPart}${commitsPart}`;
}

export function buildUserMessage(p: UserMessageParts): string {
  const conventions = p.conventions ?? "(none provided)";
  return `## PROJECT CONVENTIONS (CLAUDE.md)
${conventions}

## CURRENT SPEC — existing requirements
Existing requirement keys you may link to:
${p.existingList || "(none found)"}

Next available requirement number for NEW requirements: ${p.nextKey} (use ${p.nextKey} and up, in order).

Full spec for context:
${p.specText}

${alreadyBuiltBlock(p.taskSummary ?? [], p.recentCommits ?? [])}

## APPROVED IDEA
${ideaBlock(p.idea)}

## TARGET REPO SLICE
${sliceBlock(p.slice)}

---
Now produce the tasks for the approved idea, following all rules.`;
}

export function correctiveMessage(errors: string[]): string {
  return `The previous output was rejected for these reasons:
${errors.map((e) => `- ${e}`).join("\n")}

Produce a corrected version that fixes every issue. Return only the structured output, same format.`;
}
