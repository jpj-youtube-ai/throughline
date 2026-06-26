import { desc, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { ideaPhotos } from "../db/schema";

/** The photo ids attached to an idea (REQ-031), newest-first — for building issue
 *  image links. */
export async function loadIdeaPhotos(db: Db, ideaId: string): Promise<{ id: string }[]> {
  return db.select({ id: ideaPhotos.id }).from(ideaPhotos).where(eq(ideaPhotos.ideaId, ideaId)).orderBy(desc(ideaPhotos.createdAt));
}

/** Fetch a single idea photo's bytes + media type by id, or null (REQ-031). */
export async function getIdeaPhoto(db: Db, id: string): Promise<{ image: Buffer; mediaType: string } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await db.select({ image: ideaPhotos.image, mediaType: ideaPhotos.mediaType }).from(ideaPhotos).where(eq(ideaPhotos.id, id)).limit(1);
  return row?.image ? { image: Buffer.from(row.image as Uint8Array), mediaType: row.mediaType } : null;
}
