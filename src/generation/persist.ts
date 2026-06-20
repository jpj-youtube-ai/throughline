import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { ideas, requirements, tasks } from "../db/schema";
import { emitEvent } from "../db/events";
import { reconcileRequirementStatus } from "../requirements/lifecycle";
import type { GenerationOutput } from "../schema";

export interface PersistGenerationInput {
  ideaId: string;
  output: GenerationOutput;
  model: string;
  usage: { input_tokens: number; output_tokens: number } | null;
  actorId?: string | null;
}

export interface PersistGenerationResult {
  taskKeys: string[];
  newRequirementKeys: string[];
}

const pad3 = (n: number): string => String(n).padStart(3, "0");

function maxNumber(keys: string[]): number {
  let max = 0;
  for (const k of keys) {
    const m = /-(\d+)$/.exec(k);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max;
}

function renderBody(body: { pointers: string[]; acceptance_check: string }): string {
  const pointers = body.pointers.map((p) => `- ${p}`).join("\n");
  return `**Pointers**\n${pointers}\n\n**Acceptance check:** ${body.acceptance_check}`;
}

/**
 * Persist a generation result (REQ-008): mint REQ-NNN for each new requirement
 * (insert provenance=voted/planned + requirement.declared), mint TASK-NNN for
 * each task (resolving its REQ link to a requirement_id; the structured body is
 * rendered to the body text column), emit one tasks.generated, and move the idea
 * to `generated` — all in one transaction. Only ever called with a validated,
 * complete result, so it never writes partial tasks.
 */
export async function persistGeneration(
  db: Db,
  input: PersistGenerationInput,
): Promise<PersistGenerationResult> {
  return db.transaction(async (tx) => {
    const [idea] = await tx
      .select({ state: ideas.state })
      .from(ideas)
      .where(eq(ideas.id, input.ideaId))
      .for("update")
      .limit(1);
    if (!idea) throw new Error("Idea not found.");
    if (idea.state !== "approved") {
      throw new Error(`Idea is ${idea.state}, not approved — refusing to generate.`);
    }

    // Mint new requirements, re-keying the generator's suggested REQ-NNN to the
    // DB's actual next number (the suggested key is a placeholder).
    const existingReqs = await tx.select({ key: requirements.key, id: requirements.id }).from(requirements);
    const keyToReqId = new Map(existingReqs.map((r) => [r.key, r.id]));
    let reqMax = maxNumber(existingReqs.map((r) => r.key));

    const suggestedToMinted = new Map<string, string>();
    const newRequirementKeys: string[] = [];
    for (const nr of input.output.new_requirements) {
      const mintedKey = `REQ-${pad3(++reqMax)}`;
      const [row] = await tx
        .insert(requirements)
        .values({
          key: mintedKey,
          title: nr.title,
          description: nr.description,
          status: "planned",
          provenance: "voted",
          originIdeaId: input.ideaId,
        })
        .returning({ id: requirements.id });
      keyToReqId.set(mintedKey, row.id);
      suggestedToMinted.set(nr.key, mintedKey);
      newRequirementKeys.push(mintedKey);
      await emitEvent(tx, {
        type: "requirement.declared",
        subjectType: "requirement",
        subjectId: row.id,
        actorId: input.actorId ?? null,
        payload: { provenance: "voted", key: mintedKey, origin_idea_id: input.ideaId },
      });
    }

    // Mint tasks, resolving each REQ link (existing key, or a re-keyed new one).
    const existingTasks = await tx.select({ key: tasks.key }).from(tasks);
    let taskMax = maxNumber(existingTasks.map((t) => t.key));

    const taskKeys: string[] = [];
    const touchedReqs = new Set<string>();
    for (const t of input.output.tasks) {
      const reqKey = suggestedToMinted.get(t.requirement_key) ?? t.requirement_key;
      const requirementId = keyToReqId.get(reqKey);
      if (!requirementId) {
        throw new Error(`Task "${t.title}" references unknown requirement ${t.requirement_key}.`);
      }
      const taskKey = `TASK-${pad3(++taskMax)}`;
      await tx.insert(tasks).values({
        key: taskKey,
        title: t.title,
        body: renderBody(t.body),
        requirementId,
        originIdeaId: input.ideaId,
        effort: t.effort,
        risk: t.risk,
        confidence: t.confidence,
      });
      taskKeys.push(taskKey);
      touchedReqs.add(requirementId);
    }

    await emitEvent(tx, {
      type: "tasks.generated",
      subjectType: "idea",
      subjectId: input.ideaId,
      actorId: input.actorId ?? null,
      payload: {
        task_keys: taskKeys,
        req_keys: newRequirementKeys,
        model: input.model,
        tokens: input.usage,
      },
    });

    // Each requirement that received a task is now in progress (planned →
    // building), in the same transaction as the task writes.
    for (const requirementId of touchedReqs) {
      await reconcileRequirementStatus(tx, requirementId, input.actorId ?? null);
    }

    await tx.update(ideas).set({ state: "generated", updatedAt: new Date() }).where(eq(ideas.id, input.ideaId));

    return { taskKeys, newRequirementKeys };
  });
}
