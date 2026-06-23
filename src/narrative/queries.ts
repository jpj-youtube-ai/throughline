import { desc, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { narratives } from "../db/schema";
import type { NarrativeContent } from "./generate";

export interface LatestNarrative {
  generatedAt: Date;
  eventCount: number;
  content: NarrativeContent;
  roadmapImage: Buffer | null;
}

export async function getLatestNarrative(db: Db, projectId?: string): Promise<LatestNarrative | null> {
  const [row] = await db
    .select({ generatedAt: narratives.generatedAt, eventCount: narratives.eventCount, content: narratives.content, roadmapImage: narratives.roadmapImage })
    .from(narratives)
    .where(projectId ? eq(narratives.projectId, projectId) : undefined)
    .orderBy(desc(narratives.generatedAt))
    .limit(1);
  return row
    ? { generatedAt: row.generatedAt, eventCount: row.eventCount, content: row.content as NarrativeContent, roadmapImage: row.roadmapImage ? Buffer.from(row.roadmapImage as Uint8Array) : null }
    : null;
}
