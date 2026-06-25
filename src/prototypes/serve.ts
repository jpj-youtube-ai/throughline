import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { prototypes } from "../db/schema";

/** Fetch a prototype's rendered PNG by id, or null. */
export async function getPrototypePng(db: Db, id: string): Promise<Buffer | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await db.select({ img: prototypes.image }).from(prototypes).where(eq(prototypes.id, id)).limit(1);
  return row?.img ? Buffer.from(row.img as Uint8Array) : null;
}
