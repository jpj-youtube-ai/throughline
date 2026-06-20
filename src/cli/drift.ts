import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { eq } from "drizzle-orm";
import { loadDotenv } from "../env";
import { createDb } from "../db/client";
import { project, tasks, requirements } from "../db/schema";
import { getPullRequest } from "../github/app";
import { detectDrift } from "../drift/detect";
import { flagDrift } from "../drift/flag";

// Run a PR-time drift check (REQ-013): npm run drift -- --pr <number>
// Fetches the PR diff via the App, finds the task from the [TASK-NNN] title,
// detects out-of-scope work, and flags it (never auto-resolves).
async function main(): Promise<void> {
  loadDotenv();
  const { values } = parseArgs({ options: { pr: { type: "string" } } });
  if (!values.pr) throw new Error("Usage: npm run drift -- --pr <number>");
  const prNumber = Number(values.pr);

  const { db, close } = createDb();
  try {
    const [proj] = await db.select().from(project).limit(1);
    if (!proj) throw new Error("No project bound (REQ-002).");

    const { title, diff } = await getPullRequest(proj.installationId, proj.repoFullName, prNumber);
    const m = /\[TASK-(\d+)\]/.exec(title);
    if (!m) throw new Error(`PR #${prNumber} title has no [TASK-NNN]: "${title}"`);
    const taskKey = `TASK-${m[1]}`;

    const [task] = await db
      .select({ id: tasks.id, requirementId: tasks.requirementId })
      .from(tasks)
      .where(eq(tasks.key, taskKey))
      .limit(1);
    if (!task) throw new Error(`No task ${taskKey}.`);
    const [req] = await db
      .select({ key: requirements.key, title: requirements.title, description: requirements.description })
      .from(requirements)
      .where(eq(requirements.id, task.requirementId))
      .limit(1);

    const result = await detectDrift({
      diff,
      requirementKey: req.key,
      requirementTitle: req.title,
      requirementDescription: req.description,
    });
    if (!result.ok) {
      console.error(`[drift] detection failed: ${result.failure}`);
      process.exit(1);
    }
    if (result.unmappedItems.length === 0) {
      console.error(`[drift] ${taskKey}: on-scope, no drift.`);
      return;
    }
    const flag = await flagDrift(db, { taskId: task.id, prNumber, unmappedItems: result.unmappedItems });
    console.error(`[drift] ${taskKey}: flagged ${result.unmappedItems.length} unmapped item(s) (${flag?.id}).`);
  } finally {
    await close();
  }
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? "").href;
if (isMain) {
  main().catch((e) => {
    console.error("[drift] failed:", e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
