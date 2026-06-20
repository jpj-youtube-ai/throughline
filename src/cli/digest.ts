import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { desc, eq } from "drizzle-orm";
import { loadDotenv } from "../env";
import { createDb } from "../db/client";
import { events, project } from "../db/schema";
import { listActivity } from "../events/feed";
import { composeDigest } from "../digest/compose";
import { sendDigest } from "../digest/send";

// Preview or send the outbound digest (REQ-026):
//   npm run digest          dry-run — compose + print, never posts
//   npm run digest -- --send post to the configured webhook + record it
async function main(): Promise<void> {
  loadDotenv();
  const { values } = parseArgs({ options: { send: { type: "boolean" } } });
  const { db, close } = createDb();
  try {
    if (values.send) {
      const r = await sendDigest(db);
      console.error(r.sent ? `[digest] sent (${r.eventCount} decisions)` : `[digest] not sent: ${r.reason ?? r.failure}`);
      if (r.sent) console.error(`\n${r.text}`);
      return;
    }

    // Dry-run: compose what would be sent, print it, post nothing.
    const [last] = await db
      .select({ at: events.createdAt })
      .from(events)
      .where(eq(events.type, "digest.sent"))
      .orderBy(desc(events.createdAt))
      .limit(1);
    const since = last?.at ?? null;
    const fresh = (await listActivity(db, 500)).filter((it) => !since || it.createdAt > since);
    if (fresh.length === 0) {
      console.error("[digest] nothing new since the last digest.");
      return;
    }
    const eventDigest = fresh
      .slice()
      .reverse()
      .map((it) => `- ${it.actor ?? "system"} ${it.verb}${it.subject ? ` ${it.subject}` : ""}${it.why ? ` — ${it.why}` : ""}`)
      .join("\n");
    const composed = await composeDigest({ eventDigest, since: since ? since.toISOString() : null });
    const [proj] = await db.select({ url: project.digestWebhookUrl }).from(project).limit(1);
    console.error(`[digest] DRY RUN (${fresh.length} decisions; webhook ${proj?.url ? "configured" : "NOT configured"}). Use --send to post.\n`);
    console.error(composed.ok ? composed.text : `[digest] compose failed: ${composed.failure}`);
  } finally {
    await close();
  }
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? "").href;
if (isMain) {
  main().catch((e) => {
    console.error("[digest] failed:", e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
