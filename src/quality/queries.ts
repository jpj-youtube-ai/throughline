import { and, eq, isNotNull, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { events } from "../db/schema";

// Cheap proxy for the Why-quality card: how many decisions carry a recorded why.
// The LLM grader (reviewWhyQuality) stays on-demand on the page; never on load.
// When projectId is given, scopes to that project's events only.
export async function countRationales(db: Db, projectId?: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`cast(count(*) as integer)` })
    .from(events)
    .where(
      projectId
        ? and(isNotNull(events.rationale), eq(events.projectId, projectId))
        : isNotNull(events.rationale),
    );
  return row?.n ?? 0;
}
