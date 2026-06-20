import { eq, desc } from "drizzle-orm";
import type { Db } from "../db/client";
import { driftFlags, tasks } from "../db/schema";

export interface OpenDriftFlag {
  id: string;
  taskKey: string;
  prNumber: number;
  unmappedItems: string[];
  createdAt: Date;
}

export async function listOpenDriftFlags(db: Db): Promise<OpenDriftFlag[]> {
  const rows = await db
    .select({
      id: driftFlags.id,
      taskKey: tasks.key,
      prNumber: driftFlags.prNumber,
      unmappedItems: driftFlags.unmappedItems,
      createdAt: driftFlags.createdAt,
    })
    .from(driftFlags)
    .innerJoin(tasks, eq(driftFlags.taskId, tasks.id))
    .where(eq(driftFlags.status, "open"))
    .orderBy(desc(driftFlags.createdAt));
  return rows.map((r) => ({ ...r, unmappedItems: (r.unmappedItems as string[]) ?? [] }));
}
