import { eq, desc } from "drizzle-orm";
import type { Db } from "../db/client";
import { events } from "../db/schema";

export interface DigestSummary {
  count: number;
  lastGeneratedAt: Date | null;
}

// Cheap proxy for the Digest card: how many digests exist and when the last was
// generated. No LLM (composeDigest is the LLM path; the dashboard never calls it).
export async function digestSummary(db: Db): Promise<DigestSummary> {
  const rows = await db
    .select({ at: events.createdAt })
    .from(events)
    .where(eq(events.type, "digest.generated"))
    .orderBy(desc(events.createdAt));
  return { count: rows.length, lastGeneratedAt: rows[0]?.at ?? null };
}

export interface DigestEntry {
  at: Date;
  eventCount: number;
  text: string | null;
}

// The most recent generated digests, newest first — for the Digest page.
export async function recentDigests(db: Db, limit = 10): Promise<DigestEntry[]> {
  const rows = await db
    .select({ at: events.createdAt, payload: events.payload })
    .from(events)
    .where(eq(events.type, "digest.generated"))
    .orderBy(desc(events.createdAt))
    .limit(limit);
  return rows.map((r) => {
    const p = r.payload as { text?: string; event_count?: number };
    return { at: r.at, eventCount: p.event_count ?? 0, text: p.text ?? null };
  });
}
