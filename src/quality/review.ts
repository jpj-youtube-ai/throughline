import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { Db } from "../db/client";
import { createClient } from "../anthropic";
import { listActivity } from "../events/feed";

const GradesSchema = z
  .object({
    grades: z
      .array(
        z
          .object({
            id: z.string().describe("The id of the rationale being graded, copied from the input."),
            score: z.number().int().min(0).max(100).describe("0–100: clarity, specificity, and real reasoning."),
            critique: z
              .string()
              .describe("One or two sentences: what is strong, or what reasoning is missing."),
          })
          .strict(),
      )
      .describe("One grade per input rationale."),
  })
  .strict();

export interface RationaleItem {
  id: string; // event seq, as a string
  kind: string; // human label of the decision (the verb)
  subject: string | null;
  rationale: string;
}

export interface Grade {
  id: string;
  score: number;
  critique: string;
}

export type GradeFn = (items: RationaleItem[]) => Promise<{ ok: true; grades: Grade[] } | { ok: false; failure: string }>;

const SYSTEM = `You assess the quality of decision rationales — the "why" recorded with each decision in a project log. For each item, score 0–100 on: clarity, specificity, and whether it gives a genuine reason (a cause, tradeoff, or consequence) rather than restating the decision or leaning on filler ("it would be good", "makes sense"). Reward concrete, falsifiable reasoning; penalise vagueness and circularity. Return a short, direct critique for each. Copy each item's id exactly.`;

// LLM grader (REQ-027): grade a batch of rationales in one call. Live.
export async function gradeRationales(args: {
  items: RationaleItem[];
  client?: Anthropic;
  modelId?: string;
}): Promise<{ ok: true; grades: Grade[] } | { ok: false; failure: string }> {
  if (args.items.length === 0) return { ok: true, grades: [] };
  const client = args.client ?? createClient();
  const body = args.items
    .map((it) => `[${it.id}] (${it.kind}${it.subject ? ` ${it.subject}` : ""}) "${it.rationale}"`)
    .join("\n");

  let message: Anthropic.Message;
  try {
    message = await client.messages.create({
      model: args.modelId ?? "claude-opus-4-8",
      max_tokens: 6000,
      system: SYSTEM,
      thinking: { type: "adaptive" },
      output_config: { format: zodOutputFormat(GradesSchema) },
      messages: [{ role: "user", content: `Grade each rationale.\n\n${body}` }],
    });
  } catch (e) {
    return { ok: false, failure: `API error: ${(e as Error).message}` };
  }
  const tb = message.content.find((b) => b.type === "text") as Anthropic.TextBlock | undefined;
  if (!tb) return { ok: false, failure: "no output from the model" };
  try {
    const parsed = GradesSchema.safeParse(JSON.parse(tb.text));
    if (!parsed.success) return { ok: false, failure: "malformed grading output" };
    return { ok: true, grades: parsed.data.grades };
  } catch {
    return { ok: false, failure: "grading output was not valid JSON" };
  }
}

export interface GradedRationale extends RationaleItem {
  score: number;
  critique: string;
}

export type WhyReview =
  | { ok: true; items: GradedRationale[]; average: number; count: number }
  | { ok: false; failure: string };

const defaultGrade: GradeFn = (items) => gradeRationales({ items });

/**
 * Review the quality of the project's rationales (REQ-027): take the decisions
 * that carry a why (from the log), grade each, and return them worst-first so the
 * thin reasoning surfaces. Report-only — grades nothing into the log; the grader
 * is injectable so the merge is testable without the API.
 */
export async function reviewWhyQuality(db: Db, grade: GradeFn = defaultGrade, limit = 40): Promise<WhyReview> {
  const items: RationaleItem[] = (await listActivity(db, undefined, 400))
    .filter((it) => it.why && it.why.trim())
    .slice(0, limit)
    .map((it) => ({ id: String(it.seq), kind: it.verb, subject: it.subject, rationale: it.why as string }));

  if (items.length === 0) return { ok: true, items: [], average: 0, count: 0 };

  const res = await grade(items);
  if (!res.ok) return { ok: false, failure: res.failure };

  const byId = new Map(res.grades.map((g) => [g.id, g]));
  const graded: GradedRationale[] = items
    .map((it) => {
      const g = byId.get(it.id);
      return g ? { ...it, score: g.score, critique: g.critique } : null;
    })
    .filter((x): x is GradedRationale => x !== null)
    .sort((a, b) => a.score - b.score);

  const average = graded.length ? Math.round(graded.reduce((n, g) => n + g.score, 0) / graded.length) : 0;
  return { ok: true, items: graded, average, count: graded.length };
}
