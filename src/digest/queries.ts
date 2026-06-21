import { eq, desc } from "drizzle-orm";
import type { Db } from "../db/client";
import { events } from "../db/schema";

export interface DigestSummary {
  count: number;
  lastSentAt: Date | null;
}

// Cheap proxy for the Digest card: how many digests have gone out, and when the
// last one did. No LLM (composeDigest is the LLM path; the dashboard never calls it).
export async function digestSummary(db: Db): Promise<DigestSummary> {
  const rows = await db
    .select({ at: events.createdAt })
    .from(events)
    .where(eq(events.type, "digest.sent"))
    .orderBy(desc(events.createdAt));
  return { count: rows.length, lastSentAt: rows[0]?.at ?? null };
}
