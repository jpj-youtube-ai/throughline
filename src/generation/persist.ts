import { eq, isNull } from "drizzle-orm";
import type { Db } from "../db/client";
import { ideas, requirements, tasks } from "../db/schema";
import { emitEvent } from "../db/events";
import { reconcileRequirementStatus } from "../requirements/lifecycle";
import type { GenerationOutput } from "../schema";
import { pad3, maxNumber, renderBody } from "./persist-helpers";
import type { Usage } from "./run";

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
      .select({ state: ideas.state, projectId: ideas.projectId })
      .from(ideas)
      .where(eq(ideas.id, input.ideaId))
      .for("update")
      .limit(1);
    if (!idea) throw new Error("Idea not found.");
    if (idea.state !== "approved") {
      throw new Error(`Idea is ${idea.state}, not approved — refusing to generate.`);
    }

    const projectId = idea.projectId ?? null;

    // Mint new requirements, re-keying the generator's suggested REQ-NNN to the
    // DB's actual next number within the project (the suggested key is a placeholder).
    // keyToReqId is scoped to this project so tasks never link to another project's REQ.
    const existingReqs = projectId !== null
      ? await tx.select({ key: requirements.key, id: requirements.id }).from(requirements).where(eq(requirements.projectId, projectId))
      : await tx.select({ key: requirements.key, id: requirements.id }).from(requirements).where(isNull(requirements.projectId));
    const keyToReqId = new Map(existingReqs.map((r) => [r.key, r.id]));

    // Count only requirements within this project to get the next project-scoped number.
    const projectReqKeys = projectId !== null
      ? (await tx.select({ key: requirements.key }).from(requirements).where(eq(requirements.projectId, projectId))).map((r) => r.key)
      : (await tx.select({ key: requirements.key }).from(requirements).where(isNull(requirements.projectId))).map((r) => r.key);
    let reqMax = maxNumber(projectReqKeys);

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
          projectId,
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
        projectId: projectId ?? undefined,
      });
    }

    // Mint tasks, resolving each REQ link (existing key, or a re-keyed new one).
    // Task numbering is scoped per project.
    const projectTaskKeys = projectId !== null
      ? (await tx.select({ key: tasks.key }).from(tasks).where(eq(tasks.projectId, projectId))).map((t) => t.key)
      : (await tx.select({ key: tasks.key }).from(tasks).where(isNull(tasks.projectId))).map((t) => t.key);
    let taskMax = maxNumber(projectTaskKeys);

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
        projectId,
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
      projectId: projectId ?? undefined,
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

export interface PersistForRequirementInput {
  reqId: string;
  output: GenerationOutput;
  model: string;
  usage: Usage;
  actorId?: string | null;
}

/**
 * Persist generation for a single requirement (REQ-008, requirement-driven): mint
 * TASK-NNN for each output task, ALL linked to reqId (the requirement is the unit —
 * the model's requirement_key and new_requirements are ignored), emit one
 * tasks.generated (subject = the requirement), and advance it planned→building —
 * one transaction. Refuses if the requirement already has tasks. No idea involved.
 */
export async function persistGenerationForRequirement(
  db: Db,
  input: PersistForRequirementInput,
): Promise<{ taskKeys: string[] }> {
  return db.transaction(async (tx) => {
    const [req] = await tx
      .select({ id: requirements.id, projectId: requirements.projectId })
      .from(requirements)
      .where(eq(requirements.id, input.reqId))
      .for("update")
      .limit(1);
    if (!req) throw new Error("Requirement not found.");

    const projectId = req.projectId ?? null;

    const existingForReq = await tx.select({ id: tasks.id }).from(tasks).where(eq(tasks.requirementId, input.reqId)).limit(1);
    if (existingForReq.length > 0) throw new Error("Requirement already has tasks — refusing to generate.");

    // Task numbering scoped per project.
    const projectTaskKeys = projectId !== null
      ? (await tx.select({ key: tasks.key }).from(tasks).where(eq(tasks.projectId, projectId))).map((t) => t.key)
      : (await tx.select({ key: tasks.key }).from(tasks).where(isNull(tasks.projectId))).map((t) => t.key);
    let taskMax = maxNumber(projectTaskKeys);

    const taskKeys: string[] = [];
    for (const t of input.output.tasks) {
      const taskKey = `TASK-${pad3(++taskMax)}`;
      await tx.insert(tasks).values({
        key: taskKey,
        title: t.title,
        body: renderBody(t.body),
        requirementId: input.reqId, // forced link — the requirement is the unit
        effort: t.effort,
        risk: t.risk,
        confidence: t.confidence,
        projectId,
      });
      taskKeys.push(taskKey);
    }

    await emitEvent(tx, {
      type: "tasks.generated",
      subjectType: "requirement",
      subjectId: input.reqId,
      actorId: input.actorId ?? null,
      payload: { task_keys: taskKeys, req_keys: [], model: input.model, tokens: input.usage },
      projectId: projectId ?? undefined,
    });

    await reconcileRequirementStatus(tx, input.reqId, input.actorId ?? null);

    return { taskKeys };
  });
}
