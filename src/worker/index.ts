import { and, eq } from "drizzle-orm";
import { loadDotenv } from "../env";
import { createDb, type Db } from "../db/client";
import { checkLiveSchema, hasDrift, formatDrift } from "../db/check";
import { ideas } from "../db/schema";
import { generateForApprovedIdea, type GenerateForIdeaResult } from "../generation/orchestrate";
import { createIssuesForTasks, closeIssuesForMergedTasks, type CreateIssuesResult, type CloseIssuesResult } from "../github/issues";
import { createBranchesForClaimedTasks } from "../github/branches";
import { materializeSpec, type MaterializeResult } from "../spec/materialize";
import { generateDigest, type GenerateResult } from "../digest/send";
import { listProjects } from "../project/list";
import { formatError } from "./format-error";

// Injectable overrides — used in tests to avoid hitting external services.
export interface WorkerDeps {
  generate?: (db: Db, ideaId: string) => Promise<GenerateForIdeaResult>;
  createIssues?: (db: Db, projectId: string) => Promise<CreateIssuesResult>;
  createBranches?: (db: Db, projectId: string) => Promise<{ created: string[] }>;
  closeIssues?: (db: Db, projectId: string) => Promise<CloseIssuesResult>;
  specMaterialize?: (db: Db, projectId: string) => Promise<MaterializeResult>;
  digest?: (db: Db, opts: { projectId: string }) => Promise<GenerateResult>;
}

/**
 * Process one project during a tick: generate tasks for approved ideas, run
 * GitHub sweeps, materialize spec if something generated, and generate digest.
 * Each step is isolated in its own try/catch so a failure in one step does not
 * abort the others (REQ-029, REQ-008).
 */
export async function tickForProject(
  db: Db,
  proj: { id: string; repoFullName: string; defaultBranch: string },
  deps: WorkerDeps = {},
): Promise<{ didGenerate: boolean }> {
  const {
    generate = generateForApprovedIdea,
    createIssues = (d, pid) => createIssuesForTasks(d, pid),
    createBranches = (d, pid) => createBranchesForClaimedTasks(d, pid),
    closeIssues = (d, pid) => closeIssuesForMergedTasks(d, pid),
    specMaterialize = (d, pid) => materializeSpec(d, pid),
    digest = (d, opts) => generateDigest(d, opts),
  } = deps;

  let didGenerate = false;

  // Poll approved ideas scoped to this project.
  const pending = await db
    .select({ id: ideas.id, title: ideas.title })
    .from(ideas)
    .where(and(eq(ideas.state, "approved"), eq(ideas.projectId, proj.id)));

  for (const idea of pending) {
    console.error(`[worker][${proj.id}] generating for "${idea.title}" (${idea.id})…`);
    try {
      const r = await generate(db, idea.id);
      if (r.ok) didGenerate = true;
      console.error(r.ok ? `[worker][${proj.id}] ✓ ${r.taskKeys?.length ?? 0} task(s)` : `[worker][${proj.id}] ✗ ${r.failure}`);
    } catch (e) {
      console.error(`[worker][${proj.id}] generation error:`, formatError(e));
    }
  }

  // Open GitHub issues for any tasks in this project that don't have one yet (REQ-009).
  try {
    const { created } = await createIssues(db, proj.id);
    if (created.length) console.error(`[worker][${proj.id}] opened ${created.length} issue(s): ${created.join(", ")}`);
  } catch (e) {
    console.error(`[worker][${proj.id}] issue creation skipped:`, formatError(e));
  }

  // Create branches for any claimed task in this project that doesn't have one yet (REQ-011).
  try {
    const { created } = await createBranches(db, proj.id);
    if (created.length) console.error(`[worker][${proj.id}] created ${created.length} branch(es): ${created.join(", ")}`);
  } catch (e) {
    console.error(`[worker][${proj.id}] branch creation skipped:`, formatError(e));
  }

  // Close GitHub issues for tasks whose PR merged (REQ-009). Outbound + idempotent;
  // the issue_closed_at marker bounds this to once per task and lets it self-heal.
  try {
    const { closed } = await closeIssues(db, proj.id);
    if (closed.length) console.error(`[worker][${proj.id}] closed ${closed.length} issue(s): ${closed.join(", ")}`);
  } catch (e) {
    console.error(`[worker][${proj.id}] issue close skipped:`, formatError(e));
  }

  // Re-materialize the spec for this project when requirements/tasks changed (REQ-012).
  if (didGenerate) {
    try {
      const m = await specMaterialize(db, proj.id);
      console.error(`[worker][${proj.id}] spec materialized (${m.requirementCount} reqs, ${m.sha.slice(0, 7)})`);
    } catch (e) {
      console.error(`[worker][${proj.id}] spec materialization skipped:`, formatError(e));
    }
  }

  // Generate digest for this project if due (REQ-026).
  try {
    const d = await digest(db, { projectId: proj.id });
    if (d.generated) console.error(`[worker][${proj.id}] digest generated (${d.eventCount} events)`);
  } catch (e) {
    console.error(`[worker][${proj.id}] digest skipped:`, formatError(e));
  }

  return { didGenerate };
}

// One pass: iterate all projects and run tickForProject for each.
export async function tick(db: Db, deps: WorkerDeps = {}): Promise<void> {
  const projects = await listProjects(db);
  for (const proj of projects) {
    await tickForProject(db, proj, deps);
  }
}

async function main(): Promise<void> {
  loadDotenv();

  // Boot guard: refuse to start if the live DB is behind the code's schema
  // (a migration was generated but never applied). Fail loud and early here
  // instead of throwing `column does not exist` on the first request.
  const drift = await checkLiveSchema();
  if (hasDrift(drift)) {
    console.error(formatDrift(drift));
    console.error("[worker] refusing to start — apply pending migration(s) (apply-migration skill), then restart.");
    process.exit(1);
  }

  const { db } = createDb();
  const intervalMs = Number(process.env.WORKER_INTERVAL_MS ?? 10000);
  console.error(`[worker] polling for approved ideas every ${intervalMs}ms…`);
  for (;;) {
    try {
      await tick(db);
    } catch (e) {
      console.error("[worker] tick error:", formatError(e));
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

// Only run when executed directly, not when imported by tests.
// process.argv[1] is the entry file; tsx resolves it to an absolute path.
const isMain =
  typeof process !== "undefined" &&
  process.argv[1] != null &&
  (process.argv[1].endsWith("index.ts") || process.argv[1].endsWith("index.js")) &&
  // When imported as a module in tests, import.meta.url won't match argv[1] exactly,
  // but the simplest guard is checking that we're NOT being imported from a test file.
  !process.argv[1].endsWith(".test.ts") &&
  !process.argv[1].endsWith(".test.js");

if (isMain) {
  main().catch((e) => {
    console.error("[worker] fatal:", formatError(e));
    process.exit(1);
  });
}
