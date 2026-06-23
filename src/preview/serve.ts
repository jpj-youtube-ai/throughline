import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { tasks } from "@/db/schema";

/** Fetch a task's stored preview PNG by id, or null. */
export async function getPreviewPng(db: Db, id: string): Promise<Buffer | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await db.select({ img: tasks.previewImage }).from(tasks).where(eq(tasks.id, id)).limit(1);
  return row?.img ? Buffer.from(row.img as Uint8Array) : null;
}
