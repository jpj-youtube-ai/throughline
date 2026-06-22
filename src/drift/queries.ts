import { eq, desc, and } from "drizzle-orm";
import type { Db } from "../db/client";
import { driftFlags, tasks } from "../db/schema";

export interface OpenDriftFlag {
  id: string;
  taskKey: string;
  prNumber: number;
  unmappedItems: string[];
  createdAt: Date;
}

export async function listOpenDriftFlags(db: Db, projectId?: string): Promise<OpenDriftFlag[]> {
  const where = projectId
    ? and(eq(driftFlags.status, "open"), eq(tasks.projectId, projectId))
    : eq(driftFlags.status, "open");
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
    .where(where)
    .orderBy(desc(driftFlags.createdAt));
  return rows.map((r) => ({ ...r, unmappedItems: (r.unmappedItems as string[]) ?? [] }));
}
