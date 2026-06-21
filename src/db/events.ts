import { events } from "./schema";
import type { Tx } from "./client";

// The event taxonomy (SPEC §4). Every state change emits exactly one of these.
export type EventType =
  | "project.genesis_imported"
  | "project.bound"
  | "requirement.declared"
  | "requirement.status_changed"
  | "requirement.amended"
  | "idea.parked"
  | "idea.graduated"
  | "idea.submitted"
  | "idea.voted"
  | "idea.gate_passed"
  | "idea.approved"
  | "idea.rejected"
  | "tasks.generated"
  | "task.claimed"
  | "task.unclaimed"
  | "task.github_status_changed"
  | "work.logged_retroactively"
  | "spec.materialized"
  | "drift.flagged"
  | "drift.resolved"
  | "claude_md.synced"
  | "narrative.generated"
  | "digest.generated";

// Events that must carry a rationale (the "why") — SPEC §4.
const RATIONALE_REQUIRED: ReadonlySet<EventType> = new Set([
  "idea.submitted",
  "idea.approved",
  "idea.rejected",
  "work.logged_retroactively",
  "drift.resolved",
  "requirement.amended",
]);

export interface EmitEventInput {
  type: EventType;
  subjectType: string; // e.g. "idea", "task", "requirement", "project"
  subjectId?: string | null; // uuid; omit for whole-project events
  actorId?: string | null; // uuid; null/omitted = system
  payload?: Record<string, unknown>;
  rationale?: string | null;
}

/**
 * The single way an event is ever written. Takes a transaction so it can only be
 * called inside `db.transaction(...)` alongside the state write it records —
 * never write an event outside the transaction that also wrote state.
 * This is the load-bearing primitive for the whole truth model (REQ-003).
 */
export async function emitEvent(tx: Tx, input: EmitEventInput): Promise<{ id: string }> {
  if (RATIONALE_REQUIRED.has(input.type) && !input.rationale?.trim()) {
    throw new Error(`Event "${input.type}" requires a rationale (the "why").`);
  }
  const [row] = await tx
    .insert(events)
    .values({
      type: input.type,
      actorId: input.actorId ?? null,
      subjectType: input.subjectType,
      subjectId: input.subjectId ?? null,
      payload: input.payload ?? {},
      rationale: input.rationale ?? null,
    })
    .returning({ id: events.id });
  return row;
}
