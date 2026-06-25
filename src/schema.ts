import { z } from "zod";

export const EffortSchema = z
  .number()
  .int()
  .min(1)
  .max(5)
  .describe("Effort: 1 (an hour or two) to 5 (large/multi-day).");

export const RiskSchema = z
  .enum(["low", "med", "high"])
  .describe("Risk of breaking things or hitting unknowns.");

export const TaskBodySchema = z
  .object({
    pointers: z
      .array(z.string())
      .describe(
        "Files, modules, and existing patterns to follow or create — not the implementation code.",
      ),
    acceptance_check: z
      .string()
      .describe(
        "A concrete, verifiable condition proving the task is done (a test to pass, a command's output, an observable behavior).",
      ),
  })
  .strict();

export const TaskSchema = z
  .object({
    title: z.string().describe("Imperative task title. No 'TASK-' prefix."),
    requirement_key: z
      .string()
      .describe(
        "The REQ-NNN this task implements — an existing key from the spec, or one declared in new_requirements.",
      ),
    body: TaskBodySchema,
    effort: EffortSchema,
    risk: RiskSchema,
    confidence: z
      .number()
      .int()
      .min(0)
      .max(100)
      .describe("0–100: how sure you are the task as written is correct and complete."),
    prototypes: z
      .array(z.string())
      .optional()
      .default([])
      .describe("Labels of the design prototype(s) this task builds against (from the provided list). Empty unless this is frontend work matching a prototype."),
  })
  .strict();

export const NewRequirementSchema = z
  .object({
    key: z
      .string()
      .describe("New requirement key, continuing the spec's numbering (e.g. REQ-028)."),
    title: z.string(),
    description: z.string().describe("One or two sentences defining the requirement."),
  })
  .strict();

export const GenerationOutputSchema = z
  .object({
    new_requirements: z
      .array(NewRequirementSchema)
      .describe(
        "Requirements you are declaring because no existing REQ fits. Empty array if every task maps to an existing requirement.",
      ),
    tasks: z.array(TaskSchema).describe("One or more tasks implementing the idea."),
  })
  .strict();

export type GenerationOutput = z.infer<typeof GenerationOutputSchema>;

export interface SemanticContext {
  existingKeys: Set<string>;
  nextNumber: number;
  prototypeLabels: Set<string>;
}

const REQ_RE = /^REQ-(\d{3})$/;

// Checks that the JSON schema can't enforce: REQ-key format, resolution
// (existing or newly-declared), monotonic numbering, no collisions/orphans.
export function semanticErrors(out: GenerationOutput, ctx: SemanticContext): string[] {
  const errors: string[] = [];
  if (out.tasks.length === 0) errors.push("Produce at least one task.");

  const newKeys = new Set<string>();
  for (const nr of out.new_requirements) {
    const m = REQ_RE.exec(nr.key);
    if (!m) {
      errors.push(`new_requirement key "${nr.key}" must look like REQ-NNN.`);
      continue;
    }
    if (newKeys.has(nr.key)) {
      errors.push(`new_requirement key ${nr.key} is declared more than once.`);
    }
    newKeys.add(nr.key);
    if (ctx.existingKeys.has(nr.key)) {
      errors.push(
        `new_requirement ${nr.key} collides with an existing requirement; link to it instead of redeclaring.`,
      );
    } else if (Number(m[1]) < ctx.nextNumber) {
      errors.push(
        `new_requirement ${nr.key} must continue numbering at REQ-${String(ctx.nextNumber).padStart(3, "0")} or later.`,
      );
    }
    if (!nr.title.trim()) errors.push(`new_requirement ${nr.key} needs a title.`);
    if (!nr.description.trim()) errors.push(`new_requirement ${nr.key} needs a description.`);
  }

  const allowed = new Set<string>([...ctx.existingKeys, ...newKeys]);
  const usedReqs = new Set<string>();

  out.tasks.forEach((t, i) => {
    const label = `task[${i}] "${t.title || "(untitled)"}"`;
    if (!t.title.trim()) errors.push(`${label}: title is empty.`);
    if (!REQ_RE.test(t.requirement_key)) {
      errors.push(`${label}: requirement_key "${t.requirement_key}" must look like REQ-NNN.`);
    } else if (!allowed.has(t.requirement_key)) {
      errors.push(
        `${label}: requirement_key ${t.requirement_key} is neither an existing requirement nor one you declared in new_requirements. Link to an existing REQ, or declare it in new_requirements.`,
      );
    } else {
      usedReqs.add(t.requirement_key);
    }
    if (!t.body.pointers.length || t.body.pointers.some((p) => !p.trim())) {
      errors.push(`${label}: body.pointers must be a non-empty list of non-empty pointers.`);
    }
    if (!t.body.acceptance_check.trim()) {
      errors.push(`${label}: body.acceptance_check is empty.`);
    }
    for (const proto of t.prototypes) {
      if (!ctx.prototypeLabels.has(proto)) {
        errors.push(`${label}: prototype "${proto}" is not one of the available design prototypes.`);
      }
    }
  });

  for (const nk of newKeys) {
    if (!usedReqs.has(nk)) {
      errors.push(
        `new_requirement ${nk} is declared but no task links to it. Remove it or add a task that implements it.`,
      );
    }
  }

  return errors;
}
