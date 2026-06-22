import { and, asc, desc, eq } from "drizzle-orm";
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
 * new has happened. When projectId is given, scopes to that project; otherwise
 * defaults to the oldest project.
 */
export async function generateDigest(db: Db, opts: { compose?: ComposeFn; projectId?: string } = {}): Promise<GenerateResult> {
  const compose = opts.compose ?? composeDigest;

  let proj: { id: string } | undefined;
  if (opts.projectId) {
    const [p] = await db.select({ id: project.id }).from(project).where(eq(project.id, opts.projectId)).limit(1);
    proj = p;
  } else {
    const [p] = await db.select({ id: project.id }).from(project).orderBy(asc(project.createdAt)).limit(1);
    proj = p;
  }
  if (!proj) return { generated: false, reason: "no project bound" };

  const [last] = await db
    .select({ at: events.createdAt })
    .from(events)
    .where(and(eq(events.type, "digest.generated"), eq(events.projectId, proj.id)))
    .orderBy(desc(events.createdAt))
    .limit(1);
  const since = last?.at ?? null;

  const fresh = (await listActivity(db, proj.id, 500)).filter((it) => !since || it.createdAt > since);
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
