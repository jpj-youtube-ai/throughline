import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { narratives, requirements } from "../db/schema";
import { emitEvent } from "../db/events";
import { getActiveProjectId } from "../project/active";
import { listActivity } from "../events/feed";
import { generateNarrative, type GenerateNarrativeResult } from "./generate";
import { generateRoadmapHtml } from "./roadmap";

export type NarrativeGenerator = (eventDigest: string, eventCount: number) => Promise<GenerateNarrativeResult>;

export interface MaterializeNarrativeResult {
  eventCount: number;
  chapters: number;
}

export interface RoadmapDeps {
  generateRoadmap?: typeof generateRoadmapHtml;
}

const defaultGenerator: NarrativeGenerator = (eventDigest) => generateNarrative({ eventDigest });

/**
 * Generate and store the project narrative (REQ-016): turn the chronological
 * event log (with rationales) into grounded prose, store it in `narratives`, and
 * emit narrative.generated — in one transaction. The generator is injectable so
 * the storage path is testable without the API. Regenerated on demand only.
 */
export async function materializeNarrative(
  db: Db,
  generate: NarrativeGenerator = defaultGenerator,
  roadmapDeps: RoadmapDeps = {},
): Promise<MaterializeNarrativeResult> {
  // chronological (listActivity is newest-first)
  const items = (await listActivity(db, undefined, 2000)).slice().reverse();
  const eventCount = items.length;
  if (eventCount === 0) throw new Error("No events yet — nothing to narrate.");

  const eventDigest = items
    .map((it) => {
      const who = it.actor ?? "system";
      const subject = it.subject ? ` ${it.subject}` : "";
      const why = it.why ? ` — ${it.why}` : "";
      return `- ${who} ${it.verb}${subject}${why}`;
    })
    .join("\n");

  const result = await generate(eventDigest, eventCount);
  if (!result.ok) throw new Error(`Narrative generation failed: ${result.failure}`);

  const projectId = await getActiveProjectId(db, null);

  // Best-effort roadmap HTML (REQ-016): grounded in the chapters + real requirement statuses.
  const generateRoadmap = roadmapDeps.generateRoadmap ?? generateRoadmapHtml;
  let roadmapHtml: string | null = null;
  try {
    const reqRows = await db
      .select({ key: requirements.key, title: requirements.title, status: requirements.status })
      .from(requirements)
      .where(eq(requirements.projectId, projectId));
    roadmapHtml = await generateRoadmap({ chapters: result.content.chapters, requirements: reqRows });
  } catch (e) {
    console.error("[narrative] roadmap failed:", e instanceof Error ? e.message : e);
  }

  await db.transaction(async (tx) => {
    await tx.insert(narratives).values({ eventCount, content: result.content, projectId, roadmapHtml });
    await emitEvent(tx, {
      type: "narrative.generated",
      subjectType: "project",
      payload: { event_count: eventCount, chapters: result.content.chapters.length },
      projectId,
    });
  });

  return { eventCount, chapters: result.content.chapters.length };
}
