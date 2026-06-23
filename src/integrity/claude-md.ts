import { asc, eq } from "drizzle-orm";
import fs from "node:fs";
import path from "node:path";
import type { Db } from "../db/client";
import { project } from "../db/schema";
import { emitEvent } from "../db/events";
import { CONVENTIONS_MARKDOWN } from "../conventions";
import { commitFileInClone, pushClone } from "../github/commit";

const START = "<!-- THROUGHLINE:START -->";
const END = "<!-- THROUGHLINE:END -->";

// The managed block written into the target repo's CLAUDE.md (REQ-014):
// branch/commit convention, task-pickup protocol, spec contract.
export function managedBlockBody(): string {
  return `${CONVENTIONS_MARKDOWN}
## Task pickup

- Pick an open, unclaimed task from the board; it sets your branch \`task-<key>-<slug>\`.
- Implement exactly the task's linked \`REQ-NNN\`. Work beyond it is drift and is flagged at PR time.
- Open a PR whose title starts with \`[TASK-NNN]\`; it squash-merges as one clean line.

## Spec contract

- \`SPEC.md\` is a generated projection — never hand-edit it; it is materialized from the requirement log.`;
}

/**
 * Replace the managed region between the markers, or append a new one if the
 * markers are absent. Everything outside the markers is left byte-identical.
 */
export function upsertManagedBlock(existing: string, blockBody: string): string {
  const block = `${START}\n${blockBody.trim()}\n${END}`;
  const startIdx = existing.indexOf(START);
  const endIdx = existing.indexOf(END);
  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    return existing.slice(0, startIdx) + block + existing.slice(endIdx + END.length);
  }
  if (existing === "") return block + "\n";
  const sep = existing.endsWith("\n\n") ? "" : existing.endsWith("\n") ? "\n" : "\n\n";
  return existing + sep + block + "\n";
}

export type ClaudeCommitFn = (content: string) => Promise<{ sha: string }> | { sha: string };

export interface SyncClaudeMdResult {
  conventionVersion: number;
  sha: string;
  content: string;
}

/**
 * Sync the managed block into CLAUDE.md (REQ-014): upsert the marked region in
 * the current content, commit it, bump convention_version, and emit
 * claude_md.synced. The commit is injectable so the upsert is testable without a
 * clone. The caller reads the current CLAUDE.md from the clone. When projectId is
 * given, scopes to that project; otherwise defaults to the oldest project.
 */
export async function syncClaudeMd(
  db: Db,
  currentClaudeMd: string,
  commit: ClaudeCommitFn,
  projectId?: string,
): Promise<SyncClaudeMdResult> {
  let proj: { id: string; conventionVersion: number } | undefined;
  if (projectId) {
    const [p] = await db.select({ id: project.id, conventionVersion: project.conventionVersion }).from(project).where(eq(project.id, projectId)).limit(1);
    proj = p;
  } else {
    const [p] = await db.select({ id: project.id, conventionVersion: project.conventionVersion }).from(project).orderBy(asc(project.createdAt)).limit(1);
    proj = p;
  }
  if (!proj) throw new Error("No project bound (REQ-002).");

  const content = upsertManagedBlock(currentClaudeMd, managedBlockBody());
  const { sha } = await commit(content);
  const nextVersion = proj.conventionVersion + 1;

  await db.transaction(async (tx) => {
    await tx.update(project).set({ conventionVersion: nextVersion }).where(eq(project.id, proj.id));
    await emitEvent(tx, {
      type: "claude_md.synced",
      subjectType: "project",
      subjectId: proj.id,
      payload: { convention_version: nextVersion },
      projectId: proj.id,
    });
  });

  return { conventionVersion: nextVersion, sha, content };
}

export interface SyncForProjectDeps {
  readFile?: (absPath: string) => string;
  commit?: typeof commitFileInClone;
  push?: typeof pushClone;
}

/**
 * Sync the managed CLAUDE.md block for one project (REQ-014), in-app: read the
 * repo's CLAUDE.md from its clone, upsert the managed region, and — only if it
 * changed — commit, push to the default branch, bump convention_version, and emit
 * claude_md.synced. No-op (already-synced) when the block is already current;
 * creates the file when absent. fs/commit/push are injectable for tests.
 */
export async function syncClaudeMdForProject(
  db: Db,
  projectId: string,
  deps: SyncForProjectDeps = {},
): Promise<{ status: "synced" | "already-synced"; sha?: string; conventionVersion?: number }> {
  const [proj] = await db
    .select({
      id: project.id,
      localClonePath: project.localClonePath,
      claudeMdPath: project.claudeMdPath,
      repoFullName: project.repoFullName,
      installationId: project.installationId,
      defaultBranch: project.defaultBranch,
      conventionVersion: project.conventionVersion,
    })
    .from(project)
    .where(eq(project.id, projectId))
    .limit(1);
  if (!proj) throw new Error("Project not found.");

  const readFile = deps.readFile ?? ((p: string) => { try { return fs.readFileSync(p, "utf8"); } catch { return ""; } });
  const commit = deps.commit ?? commitFileInClone;
  const push = deps.push ?? pushClone;

  const current = readFile(path.join(proj.localClonePath, proj.claudeMdPath));
  const next = upsertManagedBlock(current, managedBlockBody());
  if (next === current) return { status: "already-synced" };

  const { sha } = await commit(proj.localClonePath, proj.claudeMdPath, next, "[claude-md] sync conventions");
  await push(proj.localClonePath, proj.repoFullName, proj.installationId, proj.defaultBranch);

  const nextVersion = proj.conventionVersion + 1;
  await db.transaction(async (tx) => {
    await tx.update(project).set({ conventionVersion: nextVersion }).where(eq(project.id, proj.id));
    await emitEvent(tx, {
      type: "claude_md.synced",
      subjectType: "project",
      subjectId: proj.id,
      payload: { convention_version: nextVersion },
      projectId: proj.id,
    });
  });
  return { status: "synced", sha, conventionVersion: nextVersion };
}
