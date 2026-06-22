import { desc, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { events, project } from "../db/schema";
import { emitEvent } from "../db/events";
import { listActivity } from "../events/feed";
import { composeDigest, type ComposeFn } from "./compose";

export type GenerateResult =
  | { generated: true; eventCount: number; text: string }
  | { generated: false; reason?: string; failure?: string };

/**
 * Generate the in-app digest (REQ-026): summarise the decisions since the last
 * digest and record digest.generated (the watermark for "since last digest").
 * In-app only — there is no outbound delivery. Compose is injectable so tests and
 * dry-runs never touch the API. Records nothing if no project is bound or nothing
 * new has happened.
 */
export async function generateDigest(db: Db, opts: { compose?: ComposeFn } = {}): Promise<GenerateResult> {
  const compose = opts.compose ?? composeDigest;

  const [proj] = await db.select().from(project).limit(1);
  if (!proj) return { generated: false, reason: "no project bound" };

  const [last] = await db
    .select({ at: events.createdAt })
    .from(events)
    .where(eq(events.type, "digest.generated"))
    .orderBy(desc(events.createdAt))
    .limit(1);
  const since = last?.at ?? null;

  const fresh = (await listActivity(db, 500)).filter((it) => !since || it.createdAt > since);
  if (fresh.length === 0) return { generated: false, reason: "nothing new since the last digest" };

  // chronological digest text, with the why woven in
  const eventDigest = fresh
    .slice()
    .reverse()
    .map((it) => {
      const who = it.actor ?? "system";
      const subject = it.subject ? ` ${it.subject}` : "";
      const why = it.why ? ` — ${it.why}` : "";
      return `- ${who} ${it.verb}${subject}${why}`;
    })
    .join("\n");

  const composed = await compose({ eventDigest, since: since ? since.toISOString() : null });
  if (!composed.ok) return { generated: false, failure: composed.failure };

  await db.transaction(async (tx) => {
    await emitEvent(tx, {
      type: "digest.generated",
      subjectType: "project",
      subjectId: proj.id,
      payload: { text: composed.text, event_count: fresh.length, since: since ? since.toISOString() : null },
      projectId: proj.id,
    });
  });

  return { generated: true, eventCount: fresh.length, text: composed.text };
}
