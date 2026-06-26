import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { requirements } from "../db/schema";
import { emitEvent } from "../db/events";
import { parseSpecRequirements, type ParsedRequirement } from "../genesis/import";
import { nextRequirementKey } from "./keys";

/** Title identity for merge matching: trimmed, case-insensitive. */
export function normalizeTitle(title: string): string {
  return title.trim().toLowerCase();
}

export interface ExistingReq {
  id: string;
  key: string;
  title: string;
}

export interface MergeClassification {
  toAdd: ParsedRequirement[];
  toSkip: { req: ParsedRequirement; existing: { id: string; key: string } }[];
}

/**
 * Split parsed branch-spec requirements into the genuinely-new ones (toAdd) and
 * the ones whose title already exists on the board (toSkip), matching by
 * normalized title. Preserves the parsed order in toAdd so keys mint in order.
 */
export function classifyForMerge(existing: ExistingReq[], parsed: ParsedRequirement[]): MergeClassification {
  const byTitle = new Map<string, { id: string; key: string }>();
  for (const e of existing) byTitle.set(normalizeTitle(e.title), { id: e.id, key: e.key });

  const toAdd: ParsedRequirement[] = [];
  const toSkip: MergeClassification["toSkip"] = [];
  for (const r of parsed) {
    const hit = byTitle.get(normalizeTitle(r.title));
    if (hit) toSkip.push({ req: r, existing: hit });
    else toAdd.push(r);
  }
  return { toAdd, toSkip };
}

export interface MergeResult {
  filename: string;
  added: { key: string; title: string }[];
  skipped: { title: string; existingKey: string }[];
}

/**
 * Additive branch-spec merge (REQ-032): parse a Markdown spec of NEW requirements
 * and fold them into an already-populated project. New titles are inserted
 * (status=planned, provenance=imported) each with requirement.declared; titles
 * already on the board are NOT inserted but recorded with requirement.merge_skipped.
 * Keys are minted within the project's own sequence (the doc's REQ-NNN are ignored).
 * All writes happen in one transaction. Throws (writing nothing) if 0 requirements parse.
 */
export async function mergeBranchSpec(db: Db, specText: string, filename: string, projectId: string): Promise<MergeResult> {
  const parsed = parseSpecRequirements(specText);
  if (parsed.length === 0) {
    throw new Error("No requirements found in the spec (expected **REQ-NNN — Title.** headings).");
  }

  return db.transaction(async (tx) => {
    const existing = await tx
      .select({ id: requirements.id, key: requirements.key, title: requirements.title })
      .from(requirements)
      .where(eq(requirements.projectId, projectId));

    const { toAdd, toSkip } = classifyForMerge(existing, parsed);

    for (const s of toSkip) {
      await emitEvent(tx, {
        type: "requirement.merge_skipped",
        subjectType: "requirement",
        subjectId: s.existing.id,
        payload: { filename, skipped_title: s.req.title, existing_key: s.existing.key },
        projectId,
      });
    }

    const added: { key: string; title: string }[] = [];
    for (const r of toAdd) {
      const key = await nextRequirementKey(tx, projectId);
      const [row] = await tx
        .insert(requirements)
        .values({ key, title: r.title, description: r.description, status: "planned", provenance: "imported", projectId })
        .returning({ id: requirements.id });
      await emitEvent(tx, {
        type: "requirement.declared",
        subjectType: "requirement",
        subjectId: row.id,
        payload: { provenance: "imported", key, origin_idea_id: null, source: "branch-merge", filename },
        projectId,
      });
      added.push({ key, title: r.title });
    }

    return { filename, added, skipped: toSkip.map((s) => ({ title: s.req.title, existingKey: s.existing.key })) };
  });
}
