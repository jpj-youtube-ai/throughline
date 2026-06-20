import { desc, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { events, project } from "../db/schema";
import { emitEvent } from "../db/events";
import { listActivity } from "../events/feed";
import { composeDigest, type ComposeFn } from "./compose";

const DAY = 86_400_000;

// schedule text → interval in days, or null if unset/unrecognised.
export function scheduleToDays(schedule: string | null | undefined): number | null {
  if (!schedule) return null;
  const s = schedule.trim().toLowerCase();
  const named: Record<string, number> = { daily: 1, weekly: 7, biweekly: 14, fortnightly: 14, monthly: 30 };
  if (s in named) return named[s];
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

// Is a digest due? Only when scheduled; the first one is due once a schedule is set.
export function dueForDigest(schedule: string | null | undefined, lastSentAt: Date | null, now: number): boolean {
  const days = scheduleToDays(schedule);
  if (days == null) return false;
  if (!lastSentAt) return true;
  return now - lastSentAt.getTime() >= days * DAY;
}

// POST the digest text to a webhook. Throws on a non-2xx response.
export type PostFn = (url: string, text: string) => Promise<void>;

export const httpPost: PostFn = async (url, text) => {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error(`webhook responded ${res.status}`);
};

export type SendResult =
  | { sent: true; eventCount: number; text: string }
  | { sent: false; reason?: string; failure?: string };

/**
 * Send the outbound digest (REQ-026): summarise the decisions since the last
 * digest and POST them to the configured webhook, then emit digest.sent (the
 * watermark for "since last digest"). The compose and post are injectable so
 * tests and dry-runs never touch the API or network. Sends nothing if no webhook
 * is configured or nothing new has happened — so an unconfigured project is inert.
 */
export async function sendDigest(
  db: Db,
  opts: { compose?: ComposeFn; post?: PostFn; now?: number } = {},
): Promise<SendResult> {
  const compose = opts.compose ?? composeDigest;
  const post = opts.post ?? httpPost;

  const [proj] = await db.select().from(project).limit(1);
  if (!proj) return { sent: false, reason: "no project bound" };
  if (!proj.digestWebhookUrl) return { sent: false, reason: "no digest webhook configured" };

  const [last] = await db
    .select({ at: events.createdAt })
    .from(events)
    .where(eq(events.type, "digest.sent"))
    .orderBy(desc(events.createdAt))
    .limit(1);
  const since = last?.at ?? null;

  const fresh = (await listActivity(db, 500)).filter((it) => !since || it.createdAt > since);
  if (fresh.length === 0) return { sent: false, reason: "nothing new since the last digest" };

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
  if (!composed.ok) return { sent: false, failure: composed.failure };

  // Send first (the outward action), then record it. A record failure after a
  // successful send only risks a duplicate next run, never a silent gap.
  await post(proj.digestWebhookUrl, composed.text);

  await db.transaction(async (tx) => {
    await emitEvent(tx, {
      type: "digest.sent",
      subjectType: "project",
      subjectId: proj.id,
      payload: { text: composed.text, event_count: fresh.length, since: since ? since.toISOString() : null },
    });
  });

  return { sent: true, eventCount: fresh.length, text: composed.text };
}

// Send a digest only if one is due per the project's schedule (used by the worker).
export async function sendDigestIfDue(db: Db, opts: { now?: number } = {}): Promise<SendResult> {
  const now = opts.now ?? Date.now();
  const [proj] = await db.select().from(project).limit(1);
  if (!proj) return { sent: false, reason: "no project bound" };

  const [last] = await db
    .select({ at: events.createdAt })
    .from(events)
    .where(eq(events.type, "digest.sent"))
    .orderBy(desc(events.createdAt))
    .limit(1);

  if (!dueForDigest(proj.digestSchedule, last?.at ?? null, now)) {
    return { sent: false, reason: "not due" };
  }
  return sendDigest(db, { now });
}
