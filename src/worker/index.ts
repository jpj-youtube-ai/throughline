import { eq } from "drizzle-orm";
import { loadDotenv } from "../env";
import { createDb, type Db } from "../db/client";
import { ideas } from "../db/schema";
import { generateForApprovedIdea } from "../generation/orchestrate";
import { createIssuesForTasks } from "../github/issues";
import { createBranchesForClaimedTasks } from "../github/branches";
import { materializeSpec } from "../spec/materialize";

// One pass: generate tasks for every approved idea. Once an idea generates it
// moves to `generated`, so it won't be picked up again; a generation failure
// leaves it `approved` to retry next tick (REQ-008).
async function tick(db: Db): Promise<void> {
  const pending = await db.select({ id: ideas.id, title: ideas.title }).from(ideas).where(eq(ideas.state, "approved"));
  let didGenerate = false;
  for (const idea of pending) {
    console.error(`[worker] generating for "${idea.title}" (${idea.id})…`);
    const r = await generateForApprovedIdea(db, idea.id);
    if (r.ok) didGenerate = true;
    console.error(r.ok ? `[worker] ✓ ${r.taskKeys?.length ?? 0} task(s)` : `[worker] ✗ ${r.failure}`);
  }

  // Open GitHub issues for any tasks that don't have one yet (REQ-009).
  try {
    const { created } = await createIssuesForTasks(db);
    if (created.length) console.error(`[worker] opened ${created.length} issue(s): ${created.join(", ")}`);
  } catch (e) {
    console.error("[worker] issue creation skipped:", e instanceof Error ? e.message : e);
  }

  // Create branches for any claimed task that doesn't have one yet (REQ-011).
  try {
    const { created } = await createBranchesForClaimedTasks(db);
    if (created.length) console.error(`[worker] created ${created.length} branch(es): ${created.join(", ")}`);
  } catch (e) {
    console.error("[worker] branch creation skipped:", e instanceof Error ? e.message : e);
  }

  // Re-materialize the spec when requirements/tasks changed (REQ-012).
  if (didGenerate) {
    try {
      const m = await materializeSpec(db);
      console.error(`[worker] spec materialized (${m.requirementCount} reqs, ${m.sha.slice(0, 7)})`);
    } catch (e) {
      console.error("[worker] spec materialization skipped:", e instanceof Error ? e.message : e);
    }
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
