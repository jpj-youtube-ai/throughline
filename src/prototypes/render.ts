import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "../db/client";
import { prototypes } from "../db/schema";
import { renderHtmlToPng } from "../preview/render";

/** Render any of a project's prototypes that don't have a PNG yet (REQ-030).
 *  Best-effort + idempotent (skips already-rendered); a per-prototype failure
 *  leaves image null for the next sweep. Runs in the worker (Puppeteer). */
export async function renderPrototypeImages(
  db: Db,
  projectId: string,
  render: (html: string) => Promise<Buffer> = renderHtmlToPng,
): Promise<{ rendered: string[] }> {
  const pending = await db
    .select({ id: prototypes.id, html: prototypes.html })
    .from(prototypes)
    .where(and(eq(prototypes.projectId, projectId), isNull(prototypes.image)));

  const rendered: string[] = [];
  for (const p of pending) {
    try {
      const png = await render(p.html);
      await db.update(prototypes).set({ image: png }).where(eq(prototypes.id, p.id));
      rendered.push(p.id);
    } catch (e) {
      console.error(`[prototypes] render failed for ${p.id}:`, e instanceof Error ? e.message : e);
    }
  }
  return { rendered };
}
