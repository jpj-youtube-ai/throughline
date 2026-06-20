import { eq } from "drizzle-orm";
import { loadDotenv } from "../env";
import { createDb, type Db } from "../db/client";
import { ideas } from "../db/schema";
import { generateForApprovedIdea } from "../generation/orchestrate";

// One pass: generate tasks for every approved idea. Once an idea generates it
// moves to `generated`, so it won't be picked up again; a generation failure
// leaves it `approved` to retry next tick (REQ-008).
async function tick(db: Db): Promise<void> {
  const pending = await db.select({ id: ideas.id, title: ideas.title }).from(ideas).where(eq(ideas.state, "approved"));
  for (const idea of pending) {
    console.error(`[worker] generating for "${idea.title}" (${idea.id})…`);
    const r = await generateForApprovedIdea(db, idea.id);
    console.error(r.ok ? `[worker] ✓ ${r.taskKeys?.length ?? 0} task(s)` : `[worker] ✗ ${r.failure}`);
  }
}

async function main(): Promise<void> {
  loadDotenv();
  const { db } = createDb();
  const intervalMs = Number(process.env.WORKER_INTERVAL_MS ?? 10000);
  console.error(`[worker] polling for approved ideas every ${intervalMs}ms…`);
  for (;;) {
    try {
      await tick(db);
    } catch (e) {
      console.error("[worker] tick error:", e instanceof Error ? e.message : e);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

main().catch((e) => {
  console.error("[worker] fatal:", e instanceof Error ? e.message : e);
  process.exit(1);
});
