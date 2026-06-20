import type { Db } from "../db/client";
import { narratives } from "../db/schema";
import { emitEvent } from "../db/events";
import { listActivity } from "../events/feed";
import { generateNarrative, type GenerateNarrativeResult } from "./generate";

export type NarrativeGenerator = (eventDigest: string, eventCount: number) => Promise<GenerateNarrativeResult>;

export interface MaterializeNarrativeResult {
  eventCount: number;
  chapters: number;
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
): Promise<MaterializeNarrativeResult> {
  // chronological (listActivity is newest-first)
  const items = (await listActivity(db, 2000)).slice().reverse();
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

  await db.transaction(async (tx) => {
    await tx.insert(narratives).values({ eventCount, content: result.content });
    await emitEvent(tx, {
      type: "narrative.generated",
      subjectType: "project",
      payload: { event_count: eventCount, chapters: result.content.chapters.length },
    });
  });

  return { eventCount, chapters: result.content.chapters.length };
}
