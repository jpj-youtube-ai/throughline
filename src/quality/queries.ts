import { isNotNull, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { events } from "../db/schema";

// Cheap proxy for the Why-quality card: how many decisions carry a recorded why.
// The LLM grader (reviewWhyQuality) stays on-demand on the page; never on load.
export async function countRationales(db: Db): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`cast(count(*) as integer)` })
    .from(events)
    .where(isNotNull(events.rationale));
  return row?.n ?? 0;
}
