import { and, eq, isNull, isNotNull } from "drizzle-orm";
import type { Db } from "../db/client";
import { tasks, project } from "../db/schema";
import { getInstallationOctokit, commentOnIssue } from "./app";
import { listProjects } from "../project/list";
import { loadTaskPrototypes } from "../prototypes/store";
import { slugify } from "../prototypes/slug";
import { commitFileToBranch } from "./contents";

// The slice of the octokit git API we use — typed so domain code needs no `any`
// and tests can supply an honest fake.
export interface GitRefClient {
  rest: {
    git: {
      getRef: (p: { owner: string; repo: string; ref: string }) => Promise<{ data: { object: { sha: string } } }>;
      createRef: (p: { owner: string; repo: string; ref: string; sha: string }) => Promise<unknown>;
    };
  };
}

export type CreateBranchFn = (
  installationId: number,
  repoFullName: string,
  branchName: string,
  baseBranch: string,
) => Promise<{ created: boolean }>;

export type CommitPrototypesFn = (
  db: Db, installationId: number, repoFullName: string, branch: string, taskId: string,
) => Promise<void>;

export const commitTaskPrototypes: CommitPrototypesFn = async (db, installationId, repoFullName, branch, taskId) => {
  const protos = await loadTaskPrototypes(db, taskId);
  for (const p of protos) {
    await commitFileToBranch(installationId, repoFullName, branch, `prototypes/${slugify(p.label)}.html`, p.html, `[design] prototype "${p.label}" for the task on this branch`);
  }
};

export type CommentOnIssueFn = (
  installationId: number,
  repoFullName: string,
  issueNumber: number,
  body: string,
) => Promise<void>;

/**
 * Create refs/heads/<branchName> at the base branch's HEAD, via the App
 * (REQ-011 branch convention). Idempotent: an existing ref (GitHub 422) resolves
 * to { created: false }. Any other error throws so the caller can retry.
 */
export async function createBranch(
  installationId: number,
  repoFullName: string,
  branchName: string,
  baseBranch: string,
  client?: GitRefClient,
): Promise<{ created: boolean }> {
  const [owner, repo] = repoFullName.split("/");
  const kit = client ?? ((await getInstallationOctokit(installationId)) as unknown as GitRefClient);
  const base = await kit.rest.git.getRef({ owner, repo, ref: `heads/${baseBranch}` });
  try {
    await kit.rest.git.createRef({ owner, repo, ref: `refs/heads/${branchName}`, sha: base.data.object.sha });
    return { created: true };
  } catch (e) {
    const status = (e as { status?: number }).status;
    if (status === 422) return { created: false }; // ref already exists — idempotent
    throw e;
  }
}

/**
 * The kickoff prompt posted to a task's issue when its branch is created (REQ-009).
 * References the issue's own pointers/acceptance rather than duplicating them.
 */
export function kickoffComment(taskKey: string, branchName: string): string {
  return [
    `🤖 Branch \`${branchName}\` is ready.`,
    "",
    "**Prompt for Claude Code:**",
    `> Work on ${taskKey} on branch \`${branchName}\`, following the pointers and acceptance check in this issue and the repo's CLAUDE.md conventions. Open a PR titled \`[${taskKey}] …\` when done.`,
  ].join("\n");
}

/**
 * Ensure a branch exists for every claimed task that doesn't have one yet
 * (branch_created_at IS NULL), from the project's default branch. Mirrors
 * createIssuesForTasks: idempotent, runs OUTSIDE any DB transaction (external
 * call). Stores branch_created_at as the "exists" sentinel — never github_status.
 *
 * `projectId` is optional: when omitted, resolves the oldest project (so existing
 * worker callers keep working without changes).
 */
export async function createBranchesForClaimedTasks(
  db: Db,
  projectId?: string,
  createBranchFn: CreateBranchFn = createBranch,
  commentOnIssueFn: CommentOnIssueFn = commentOnIssue,
  commitPrototypesFn: CommitPrototypesFn = commitTaskPrototypes,
): Promise<{ created: string[] }> {
  let resolvedProjectId: string;
  if (projectId) {
    resolvedProjectId = projectId;
  } else {
    const projects = await listProjects(db);
    if (projects.length === 0) throw new Error("No project bound (REQ-002).");
    resolvedProjectId = projects[0].id;
  }

  const [proj] = await db.select().from(project).where(eq(project.id, resolvedProjectId)).limit(1);
  if (!proj) throw new Error(`Project ${resolvedProjectId} not found (REQ-002).`);

  const pending = await db
    .select({ id: tasks.id, key: tasks.key, branchName: tasks.branchName, githubIssueNumber: tasks.githubIssueNumber })
    .from(tasks)
    .where(and(eq(tasks.claimState, "claimed"), isNull(tasks.branchCreatedAt), isNotNull(tasks.branchName), eq(tasks.projectId, resolvedProjectId)));

  const created: string[] = [];
  for (const t of pending) {
    if (!t.branchName) continue; // narrow; WHERE already excludes nulls
    await createBranchFn(proj.installationId, proj.repoFullName, t.branchName, proj.defaultBranch);
    try {
      await commitPrototypesFn(db, proj.installationId, proj.repoFullName, t.branchName, t.id);
    } catch (e) {
      console.error(`[branches] prototype commit skipped for ${t.key}:`, e instanceof Error ? e.message : e);
    }
    if (t.githubIssueNumber != null) {
      await commentOnIssueFn(
        proj.installationId,
        proj.repoFullName,
        t.githubIssueNumber,
        kickoffComment(t.key, t.branchName),
      );
    }
    await db.update(tasks).set({ branchCreatedAt: new Date(), updatedAt: new Date() }).where(eq(tasks.id, t.id));
    created.push(t.key);
  }
  return { created };
}
